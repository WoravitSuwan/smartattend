/** Enforces "คำนำหน้า + ชื่อ + นามสกุล" ภาษาไทยล้วน (e.g. "นายสมชาย ใจดี")
 *  for the name field collected at registration and editable later on the
 *  profile page. Longest-prefix-first so "นางสาว" isn't shadowed by "นาง". */
const TITLE_RE = /^(นางสาว|นาย|นาง)/;
const THAI_ONLY_RE = /^[฀-๿\s]+$/;

/** Returns an error message if `raw` isn't a valid Thai title + name +
 * surname, or null if it's valid. */
export function validateThaiFullName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'กรุณากรอกชื่อ-นามสกุล';

  const titleMatch = name.match(TITLE_RE);
  if (!titleMatch) {
    return 'ต้องระบุคำนำหน้า นาย/นาง/นางสาว นำหน้าชื่อ-นามสกุลภาษาไทย เช่น นายสมชาย ใจดี';
  }

  const rest = name.slice(titleMatch[0].length).trim();
  if (!rest || !rest.includes(' ')) {
    return 'กรุณากรอกทั้งชื่อและนามสกุลต่อจากคำนำหน้า เช่น นายสมชาย ใจดี';
  }

  if (!THAI_ONLY_RE.test(name)) {
    return 'ชื่อ-นามสกุลต้องเป็นภาษาไทยเท่านั้น';
  }

  return null;
}
