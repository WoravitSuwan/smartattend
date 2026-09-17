import { useEffect, useMemo, useState } from 'react';
import { Database, CheckCircle2, AlertCircle, Trash2, Loader2, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface FaceImage {
  id: string;
  student_id: string;
  student_code: string | null;
  student_name: string;
  pose: string;
  pose_label: string | null;
  image_data: string;
  captured_at: string;
  user_id: string | null;
}

interface StudentGroup {
  key: string;
  user_id: string | null;
  student_id: string;
  student_code: string | null;
  student_name: string;
  count: number;
  images: FaceImage[];
}

export default function AdminDatasetsPage() {
  const [images, setImages] = useState<FaceImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<StudentGroup | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('face_images')
        .select('id, student_id, student_code, student_name, pose, pose_label, image_data, captured_at, user_id')
        .order('captured_at', { ascending: false });
      if (error) throw error;
      setImages((data ?? []) as FaceImage[]);
    } catch (e) {
      console.error(e);
      toast.error('โหลดชุดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const groups = useMemo<StudentGroup[]>(() => {
    const map = new Map<string, StudentGroup>();
    for (const img of images) {
      const key = img.user_id ?? img.student_id;
      const g = map.get(key);
      if (g) {
        g.count++;
        g.images.push(img);
      } else {
        map.set(key, {
          key,
          user_id: img.user_id,
          student_id: img.student_id,
          student_code: img.student_code,
          student_name: img.student_name,
          count: 1,
          images: [img],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.student_name.localeCompare(b.student_name));
  }, [images]);

  const totalImages = images.length;
  const readyCount = groups.filter(g => g.count >= 30).length;

  const deleteAllOf = async (g: StudentGroup) => {
    if (!confirm(`ลบรูปทั้งหมด ${g.count} รูป ของ ${g.student_name}?`)) return;
    try {
      const q = supabase.from('face_images').delete();
      const { error } = g.user_id
        ? await q.eq('user_id', g.user_id)
        : await q.eq('student_id', g.student_id);
      if (error) throw error;
      toast.success('ลบชุดข้อมูลใบหน้าเรียบร้อย');
      setViewing(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('ลบไม่สำเร็จ');
    }
  };

  const deleteOne = async (img: FaceImage) => {
    if (!confirm('ลบรูปนี้?')) return;
    try {
      const { error } = await supabase.from('face_images').delete().eq('id', img.id);
      if (error) throw error;
      toast.success('ลบรูปเรียบร้อย');
      await load();
      if (viewing) {
        setViewing({
          ...viewing,
          images: viewing.images.filter(i => i.id !== img.id),
          count: viewing.count - 1,
        });
      }
    } catch (e) {
      console.error(e);
      toast.error('ลบรูปไม่สำเร็จ');
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display text-foreground">Dataset ใบหน้า</h1>
        <p className="text-sm text-muted-foreground">ชุดข้อมูลใบหน้านักศึกษาสำหรับเทรนโมเดล</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="w-3.5 h-3.5" /> รวม</div>
          <p className="text-2xl font-bold font-display text-foreground mt-1">{totalImages.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">ภาพ</p>
        </div>
        <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
          <div className="flex items-center gap-2 text-xs text-success"><CheckCircle2 className="w-3.5 h-3.5" /> พร้อม</div>
          <p className="text-2xl font-bold font-display text-foreground mt-1">{readyCount}</p>
          <p className="text-[10px] text-muted-foreground">คน</p>
        </div>
        <div className="bg-card rounded-2xl p-4 shadow-card border border-border">
          <div className="flex items-center gap-2 text-xs text-warning"><AlertCircle className="w-3.5 h-3.5" /> ไม่พร้อม</div>
          <p className="text-2xl font-bold font-display text-foreground mt-1">{Math.max(0, groups.length - readyCount)}</p>
          <p className="text-[10px] text-muted-foreground">คน</p>
        </div>
      </div>

      <div className="bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground bg-muted/40">
                <th className="py-2 px-3">นักศึกษา</th>
                <th className="py-2 px-3 hidden sm:table-cell">รหัส</th>
                <th className="py-2 px-3">จำนวนภาพ</th>
                <th className="py-2 px-3">สถานะ</th>
                <th className="py-2 px-3 text-right">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const ready = g.count >= 30;
                return (
                  <tr key={g.key} className="border-t border-border hover:bg-muted/40">
                    <td className="py-2.5 px-3 font-medium text-foreground">{g.student_name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground hidden sm:table-cell">{g.student_code ?? '-'}</td>
                    <td className="py-2.5 px-3 text-foreground font-mono">{g.count} / 50</td>
                    <td className="py-2.5 px-3">
                      {ready ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/15 text-success">พร้อม</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warning/15 text-warning">ต้องสแกนเพิ่ม</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewing(g)} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground" title="ดูรูป">
                          <ImageIcon className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteAllOf(g)} className="w-8 h-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-destructive" title="ลบทั้งหมด">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && (
            <div className="py-12 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลด…
            </div>
          )}
          {!loading && groups.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">ยังไม่มีชุดข้อมูลใบหน้า</div>
          )}
        </div>
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-card rounded-2xl shadow-xl border border-border max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="font-semibold text-foreground">{viewing.student_name}</p>
                <p className="text-xs text-muted-foreground">{viewing.count} รูป</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => deleteAllOf(viewing)} className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-semibold inline-flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" /> ลบทั้งหมด
                </button>
                <button onClick={() => setViewing(null)} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {viewing.images.map(img => (
                <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
                  <img src={img.image_data} alt={img.pose} className="w-full h-full object-cover" />
                  <button
                    onClick={() => deleteOne(img)}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 flex items-center justify-center shadow-lg"
                    title="ลบรูปนี้"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">
                    {img.pose_label ?? img.pose}
                  </div>
                </div>
              ))}
              {viewing.images.length === 0 && (
                <div className="col-span-full py-8 text-center text-muted-foreground text-sm">ไม่มีรูปแล้ว</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
