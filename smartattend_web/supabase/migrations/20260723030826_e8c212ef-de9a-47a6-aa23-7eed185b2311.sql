UPDATE public.courses SET section = '' WHERE section IS NULL;
ALTER TABLE public.courses ALTER COLUMN section SET DEFAULT '';
ALTER TABLE public.courses ALTER COLUMN section SET NOT NULL;