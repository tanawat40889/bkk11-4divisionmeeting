const AREAS = [
  'สินทวี', 'จุลพงษ์', 'ศรัญญา', 'เคหะรุ่งโรจน์', 'เทียนทะเล', 'พิศาล', 'มีสุข',
  'วงแหวนชัชวาลย์', 'เพชรทองคำ', 'พระราม 2', 'มั่งมี', 'ศึกษานารี 2', 'พระปิ่น 5',
  'แม้นทอง', 'ปิ่นทอง', 'ไทรทอง', 'เอส เค', 'ศิริชัย', 'ดี เค',
];
// รูปที่1 = ภาพบรรยากาศ, รูปที่2 = ภาพถ่ายหมู่
const SLOTS = 2;
// Drive folder "รูปภาพสนทนาธรรม 4 ฝ่าย"
const ROOT_ID = '1VblX98x9CqUcTl5o_Z32aiO1CxC4N7Uk';
const TZ = 'Asia/Bangkok';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ?api=status|photo is the JSON API for the GitHub Pages front end; without it, serves the built-in page
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.api) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('ส่งรูปภาพสนทนาธรรม 4 ฝ่าย')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  try {
    if (p.api == 'status') return json_(getStatus());
    if (p.api == 'photo') return json_({ photo: getPhoto(p.area, p.slot) });
    throw new Error('unknown api');
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

// upload from the GitHub Pages front end; body is JSON sent as text/plain to avoid a CORS preflight
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    return json_(upload(d.area, d.slot, d.b64, d.mime));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

const GRACE_DAYS = 5;

// days 1..GRACE_DAYS still count as the previous month
function month_() {
  let [y, m, d] = Utilities.formatDate(new Date(), TZ, 'yyyy-M-d').split('-').map(Number);
  if (d <= GRACE_DAYS && --m < 1) { m = 12; y--; }
  return y + '-' + ('0' + m).slice(-2);
}

// create=false: read-only lookup, returns null if the folder doesn't exist yet
function monthFolder_(create) {
  const root = DriveApp.getFolderById(ROOT_ID);
  const it = root.getFoldersByName(month_());
  if (it.hasNext()) return it.next();
  return create ? root.createFolder(month_()) : null;
}

// files per area per slot: { area: [[files of รูปที่1], [files of รูปที่2]] }
function files_(folder) {
  const c = {};
  AREAS.forEach(a => c[a] = Array.from({ length: SLOTS }, () => []));
  if (!folder) return c;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const m = f.getName().match(/^(.+)-รูปที่(\d+)\./);
    if (m && m[1] in c && +m[2] >= 1 && +m[2] <= SLOTS) c[m[1]][+m[2] - 1].push(f);
  }
  return c;
}

function status_(folder) {
  const c = files_(folder);
  return {
    month: month_(),
    areas: AREAS.map(a => ({
      name: a,
      sent: c[a].map(fs => fs.length > 0),
      ids: c[a].map(fs => fs.length ? fs[0].getId() : null),
    })),
  };
}

function getStatus() {
  return status_(monthFolder_(false));
}

function check_(area, slot) {
  if (AREAS.indexOf(area) < 0) throw new Error('ไม่พบพื้นที่');
  if (!(slot >= 1 && slot <= SLOTS) || slot % 1) throw new Error('ไม่พบประเภทรูป');
}

// looked up by area + slot only, so callers can never read files outside this month's folder
function getPhoto(area, slot) {
  slot = Number(slot);
  check_(area, slot);
  const f = files_(monthFolder_(false))[area][slot - 1][0];
  if (!f) return null;
  let b = f.getBlob();
  // big or non-browser formats (e.g. HEIC): fall back to Drive's small thumbnail
  if (f.getSize() > 4e6 || !/^image\/(jpeg|png|webp|gif)$/.test(b.getContentType())) b = f.getThumbnail();
  if (!b) return null;
  return { id: f.getId(), url: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
}

// re-uploading a slot moves the old photo to the trash
function upload(area, slot, b64, mime) {
  slot = Number(slot);
  check_(area, slot);
  if (!EXT[mime]) throw new Error('ไฟล์ไม่ใช่รูปภาพ');
  const bytes = Utilities.base64Decode(b64);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = monthFolder_(true);
    const old = files_(folder)[area][slot - 1];
    folder.createFile(Utilities.newBlob(bytes, mime, area + '-รูปที่' + slot + '.' + EXT[mime]));
    old.forEach(f => f.setTrashed(true));
    return status_(folder);
  } finally {
    lock.releaseLock();
  }
}
