-- ตารางนับการเรียกใช้บริการ AI ต่อผู้ใช้ เพื่อจำกัดจำนวนครั้งต่อชั่วโมง
--
-- ทำไมต้องนับในฐานข้อมูล ไม่ใช่ในตัวแปรของ Edge Function
--   Edge Function รันหลาย instance ขนานกันและถูกรีสตาร์ตเมื่อไหร่ก็ได้
--   ตัวนับในหน่วยความจำจึงรีเซ็ตเองและกันอะไรไม่ได้จริง ถ้าจะจำกัดให้ได้ผล
--   ต้องนับในที่ที่ทุก instance เห็นร่วมกัน
--
-- เขียนผ่าน RPC ที่ตรวจโควตาและบันทึกในคำสั่งเดียว (check-and-insert)
-- ไม่ให้ client เขียนตารางนี้เอง ไม่งั้นก็แค่ข้ามการบันทึกแล้วยิงต่อได้

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature     text NOT NULL,
  bytes_in    integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time
  ON public.ai_usage_logs(user_id, feature, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- ผู้ใช้ดูยอดใช้งานของตัวเองได้ แอดมินดูได้ทั้งหมด
-- ไม่มีนโยบาย INSERT/UPDATE/DELETE เลย — เขียนได้เฉพาะผ่าน RPC ข้างล่าง
-- (SECURITY DEFINER) และ service role
CREATE POLICY "Users view own ai usage"
ON public.ai_usage_logs FOR SELECT TO authenticated
USING (user_id = auth.uid() OR internal.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.ai_usage_logs TO authenticated;
GRANT ALL ON public.ai_usage_logs TO service_role;

-- ตรวจโควตาแล้วบันทึกการใช้งานในคำสั่งเดียว
-- คืน true = ใช้ได้ (บันทึกแล้ว), false = เกินโควตา (ไม่บันทึก)
CREATE OR REPLACE FUNCTION public.claim_ai_quota(
  _feature text,
  _limit_per_hour integer DEFAULT 20,
  _bytes_in integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _used integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _limit_per_hour IS NULL OR _limit_per_hour < 1 THEN _limit_per_hour := 20; END IF;

  SELECT count(*) INTO _used
  FROM public.ai_usage_logs
  WHERE user_id = _uid AND feature = _feature
    AND created_at > now() - interval '1 hour';

  IF _used >= _limit_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_usage_logs (user_id, feature, bytes_in)
  VALUES (_uid, _feature, _bytes_in);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_quota(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_quota(text, integer, integer) TO authenticated;
