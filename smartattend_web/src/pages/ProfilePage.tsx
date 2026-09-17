import MobileLayout from '@/components/MobileLayout';
import { useAuth } from '@/lib/auth-context';
import { useState, useRef } from 'react';
import { User, Mail, GraduationCap, Building2, Key, LogOut, ChevronRight, Camera, Phone, Save, X, ScanFace, Building } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { toast } from 'sonner';

const FACULTIES = [
  'คณะวิศวกรรมศาสตร์',
  'คณะบริหารธุรกิจและศิลปศาสตร์',
  'คณะศิลปกรรมและสถาปัตยกรรมศาสตร์',
  'คณะวิทยาศาสตร์และเทคโนโลยีการเกษตร',
  'วิทยาลัยเทคโนโลยีและสหวิทยาการ',
];

/** เติมขีดให้รหัสนักศึกษาอัตโนมัติ เช่น 67543210064 -> 67543210064-1
 *  ค่าที่บันทึกลงฐานข้อมูลจะถูกตัดขีดออกก่อนเสมอ เพื่อให้จับคู่กับไฟล์นำเข้าได้
 */
const formatStudentId = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 11) return digits;
  return `${digits.slice(0, 11)}-${digits.slice(11)}`;
};

const ProfilePage = () => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [studentCode, setStudentCode] = useState(user?.studentId || '');
  const [faculty, setFaculty] = useState(user?.faculty || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const isStudent = user?.role === 'student';

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ไฟล์ขนาดใหญ่เกินไป (สูงสุด 5MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (phone && !/^[0-9\-+() ]{9,15}$/.test(phone)) {
      toast.error('เบอร์โทรศัพท์ไม่ถูกต้อง');
      return;
    }
    if (!name.trim()) {
      toast.error('กรุณากรอกชื่อ');
      return;
    }
    // Strip every non-digit character before validating/saving the student code.
    const cleanedCode = studentCode.replace(/\D/g, '');
    if (isStudent) {
      if (!cleanedCode) {
        toast.error('กรุณากรอกรหัสนักศึกษา');
        return;
      }
      if (cleanedCode.length < 8 || cleanedCode.length > 13) {
        toast.error('รหัสนักศึกษาต้องเป็นตัวเลข 8-13 หลัก');
        return;
      }
    }
    updateUser({
      name: name.trim(),
      faculty: faculty || undefined,
      department: department || undefined,
      phone: phone || undefined,
      avatarUrl: avatarPreview || user?.avatarUrl,
      ...(isStudent ? { studentId: cleanedCode } : {}),
    });
    if (isStudent) setStudentCode(cleanedCode);
    setIsEditing(false);
    toast.success('บันทึกข้อมูลเรียบร้อย');
  };

  const handleCancel = () => {
    setName(user?.name || '');
    setStudentCode(user?.studentId || '');
    setFaculty(user?.faculty || '');
    setDepartment(user?.department || '');
    setPhone(user?.phone || '');
    setAvatarPreview(null);
    setIsEditing(false);
  };


  const avatarSrc = avatarPreview || user?.avatarUrl;

  const infoItems = [
    { icon: User, label: 'ชื่อ', value: user?.name },
    { icon: Mail, label: 'อีเมล', value: user?.email },
    { icon: Building, label: 'คณะ', value: user?.faculty || 'ยังไม่ได้ระบุ' },
    { icon: Building2, label: 'สาขา', value: user?.department },
    ...(user?.studentId ? [{ icon: GraduationCap, label: 'รหัสนักศึกษา', value: user.studentId }] : []),
    { icon: Phone, label: 'เบอร์โทร', value: user?.phone || 'ยังไม่ได้ระบุ' },
  ];

  return (
    <MobileLayout title="โปรไฟล์">
      <div className="px-4 py-6 space-y-6">
        {/* Avatar */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full gradient-hero flex items-center justify-center text-3xl font-bold text-primary-foreground shadow-float overflow-hidden">
              {avatarSrc ? (
                <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                user?.name?.charAt(0) || 'U'
              )}
            </div>
            {isEditing && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-elevated"
              >
                <Camera className="w-4 h-4" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <h2 className="text-lg font-bold font-display text-foreground mt-3">{user?.name}</h2>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          {user?.studentId && (
            <span className="mt-1 text-xs font-medium px-3 py-1 rounded-full bg-primary-light text-primary">
              {user.studentId}
            </span>
          )}
        </div>

        {/* Edit / Save buttons */}
        <div className="flex justify-center gap-2">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-elevated"
            >
              แก้ไขข้อมูล
            </button>
          ) : (
            <>
              <button onClick={handleSave} className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-success text-success-foreground text-xs font-semibold shadow-elevated">
                <Save className="w-3.5 h-3.5" /> บันทึก
              </button>
              <button onClick={handleCancel} className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-semibold">
                <X className="w-3.5 h-3.5" /> ยกเลิก
              </button>
            </>
          )}
        </div>

        {/* Info / Edit form */}
        <div className="bg-card rounded-2xl shadow-elevated overflow-hidden">
          {isEditing ? (
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">ชื่อ - นามสกุล</label>
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
                  <User className="w-4 h-4 text-primary" />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground outline-none"
                  />
                </div>
              </div>
              {isStudent && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">รหัสนักศึกษา</label>
                  <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
                    <GraduationCap className="w-4 h-4 text-primary" />
                    <input
                      inputMode="numeric"
                      value={studentCode}
                      onChange={(e) => setStudentCode(formatStudentId(e.target.value))}
                      placeholder="เช่น 67543210064-1"
                      maxLength={13}
                      className="flex-1 bg-transparent text-sm text-foreground outline-none tabular-nums"
                    />
                  </div>
                  <p className="text-[10px] text-warning mt-1">
                    หากแก้ไขรหัสนักศึกษา อาจต้องให้อาจารย์นำเข้ารายชื่อใหม่เพื่อจับคู่รายวิชาอีกครั้ง
                  </p>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">คณะ</label>
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
                  <Building className="w-4 h-4 text-primary" />
                  <select
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground outline-none"
                  >
                    <option value="">-- เลือกคณะ --</option>
                    {FACULTIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">สาขาวิชา</label>
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
                  <Building2 className="w-4 h-4 text-primary" />
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">เบอร์โทรศัพท์</label>
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
                  <Phone className="w-4 h-4 text-primary" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0XX-XXX-XXXX"
                    className="flex-1 bg-transparent text-sm text-foreground outline-none"
                    maxLength={15}
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">* สามารถเปลี่ยนรูปโปรไฟล์ได้โดยกดที่ไอคอนกล้อง</p>
            </div>
          ) : (
            infoItems.map((item, i) => (
              <div key={item.label} className={`flex items-center gap-3 px-4 py-3.5 ${i < infoItems.length - 1 ? 'border-b border-border' : ''}`}>
                <item.icon className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground w-24">{item.label}</span>
                <span className="text-sm font-medium text-foreground flex-1 truncate">{item.value}</span>
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {user?.role === 'student' && (
            <button
              onClick={() => navigate('/student/face-register')}
              className="w-full bg-card rounded-xl p-4 flex items-center gap-3 shadow-card hover:shadow-elevated transition-shadow text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ScanFace className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground flex-1">ลงทะเบียนใบหน้า</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button className="w-full bg-card rounded-xl p-4 flex items-center gap-3 shadow-card hover:shadow-elevated transition-shadow text-left">
            <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground flex-1">เปลี่ยนรหัสผ่าน</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="w-full bg-card rounded-xl p-4 flex items-center gap-3 shadow-card hover:shadow-elevated transition-shadow text-left"
          >
            <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center">
              <LogOut className="w-4 h-4 text-destructive" />
            </div>
            <span className="text-sm font-medium text-destructive flex-1">ออกจากระบบ</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </MobileLayout>
  );
};

export default ProfilePage;
