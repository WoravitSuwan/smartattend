import * as tf from '@tensorflow/tfjs';
import { supabase } from '@/integrations/supabase/client';

export interface ClassMapEntry {
  classIndex: number;
  studentId: string;
  studentCode: string | null;
  studentName: string | null;
}

const BUCKET = 'face-models';

/**
 * Upload a trained model to shared storage so ANY device (student phones, Pi,
 * other browsers) can use it. Without this, the model only lives in the
 * IndexedDB of the machine that trained it.
 */
export async function uploadSharedModel(
  model: tf.LayersModel,
  runId: string,
  classMap: ClassMapEntry[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    let artifacts: tf.io.ModelArtifacts | null = null;
    await model.save(
      tf.io.withSaveHandler(async (a) => {
        artifacts = a;
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
      }),
    );
    if (!artifacts) return { ok: false, error: 'serialize model failed' };
    const a = artifacts as tf.io.ModelArtifacts;

    const topology = JSON.stringify({
      modelTopology: a.modelTopology,
      weightSpecs: a.weightSpecs,
      format: a.format,
      generatedBy: a.generatedBy,
      convertedBy: a.convertedBy,
    });

    const weights = a.weightData as ArrayBuffer;

    const up1 = await supabase.storage
      .from(BUCKET)
      .upload(`${runId}/topology.json`, new Blob([topology], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
      });
    if (up1.error) throw up1.error;

    const up2 = await supabase.storage
      .from(BUCKET)
      .upload(`${runId}/weights.bin`, new Blob([weights], { type: 'application/octet-stream' }), {
        upsert: true,
        contentType: 'application/octet-stream',
      });
    if (up2.error) throw up2.error;

    const { data: auth } = await supabase.auth.getUser();

    // Deactivate previous models, then register this one as active.
    const { error: deactErr } = await supabase
      .from('face_models').update({ is_active: false }).eq('is_active', true);
    if (deactErr) throw deactErr;

    const { error: insErr } = await supabase.from('face_models').insert({
      run_id: runId,
      model_path: runId,
      class_map: classMap as unknown as never,
      num_classes: classMap.length,
      is_active: true,
      created_by: auth.user?.id ?? null,
    });
    if (insErr) throw insErr;

    return { ok: true };
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    console.warn('uploadSharedModel failed', e);
    return { ok: false, error: msg };
  }
}


/** Load the active shared model from the backend (works on any device). */
export async function loadSharedModel(): Promise<{ model: tf.LayersModel; classMap: ClassMapEntry[] } | null> {
  try {
    const { data, error } = await supabase
      .from('face_models')
      .select('run_id, model_path, class_map')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const base = data.model_path;
    const [topRes, wRes] = await Promise.all([
      supabase.storage.from(BUCKET).download(`${base}/topology.json`),
      supabase.storage.from(BUCKET).download(`${base}/weights.bin`),
    ]);
    if (topRes.error || !topRes.data || wRes.error || !wRes.data) return null;

    const top = JSON.parse(await topRes.data.text());
    const weightData = await wRes.data.arrayBuffer();

    const model = await tf.loadLayersModel(
      tf.io.fromMemory({
        modelTopology: top.modelTopology,
        weightSpecs: top.weightSpecs,
        weightData,
      }),
    );

    const classMap = (data.class_map ?? []) as unknown as ClassMapEntry[];
    return { model, classMap };
  } catch (e) {
    console.warn('loadSharedModel failed', e);
    return null;
  }
}
