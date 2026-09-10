/**
 * App language store + tiny translation helper.
 *
 * Universal-reactive (`$state` in a `.svelte.ts` module) so every component
 * that calls `t()` / `lang()` re-renders when the language changes. The choice
 * is persisted to localStorage. Default is Indonesian (the app's original
 * language).
 *
 * Coverage is incremental — strings are migrated to `DICT` per component. Any
 * key not in the dictionary falls back to the key itself, so missing
 * translations are visible rather than blank.
 */

export type Lang = "en" | "id";

const STORAGE_KEY = "appLanguage";

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "id") return v;
  } catch {
    /* localStorage may be unavailable — fall through to default */
  }
  return "id";
}

let current = $state<Lang>(readInitial());

/** Current language (reactive when read inside a component). */
export function lang(): Lang {
  return current;
}

/** Locale used by native date formatting for the active app language. */
export function locale(): "en-GB" | "id-ID" {
  return current === "id" ? "id-ID" : "en-GB";
}

export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore persistence failures */
  }
}

type Entry = { en: string; id: string };

const DICT: Record<string, Entry> = {
  // Calendar
  "calendar.day": { en: "Day", id: "Hari" },
  "calendar.week": { en: "Week", id: "Minggu" },
  "calendar.month": { en: "Month", id: "Bulan" },
  "calendar.list": { en: "List", id: "Daftar" },
  "calendar.today": { en: "Today", id: "Hari ini" },
  "calendar.prevPeriod": { en: "Previous period", id: "Periode sebelumnya" },
  "calendar.nextPeriod": { en: "Next period", id: "Periode berikutnya" },
  "calendar.more": { en: "more", id: "lagi" },
  "calendar.break": { en: "Break", id: "Istirahat" },
  "calendar.emptyList": {
    en: "No worklogs in this range yet.",
    id: "Belum ada worklog di rentang ini.",
  },
  "calendar.emptyDay": {
    en: "No worklog on this date.",
    id: "Tidak ada worklog di tanggal ini.",
  },
  "calendar.hoursMissing": { en: "Missing {n}h", id: "Kurang {n} jam" },
  "common.loading": { en: "Loading", id: "Memuat" },
  "common.close": { en: "Close", id: "Tutup" },
  "common.cancel": { en: "Cancel", id: "Batal" },
  "common.save": { en: "Save", id: "Simpan" },
  "common.later": { en: "Later", id: "Nanti" },
  "common.retry": { en: "Try again", id: "Coba lagi" },
  "common.delete": { en: "Delete", id: "Hapus" },
  "common.edit": { en: "Edit", id: "Edit" },
  "common.clear": { en: "Clear", id: "Bersihkan" },

  // Login
  "login.welcomeBack": { en: "Welcome back,", id: "Selamat datang kembali," },
  "login.jiraUrl": { en: "Jira URL", id: "URL Jira" },
  "login.email": { en: "Email", id: "Email" },
  "login.apiToken": { en: "API Token", id: "Token API" },
  "login.rememberToken": { en: "Remember token", id: "Ingat token" },
  "login.authenticating": { en: "Authenticating…", id: "Memverifikasi…" },
  "login.submit": { en: "Login", id: "Masuk" },
  "login.formLabel": { en: "Login credentials", id: "Kredensial masuk" },
  "login.tokenPlaceholder": {
    en: "Enter your API token",
    id: "Masukkan token API kamu",
  },
  "login.tokenGuide": { en: "How to create a Jira API token ↗", id: "Cara membuat API token Jira ↗" },
  "login.firstSetup": { en: "First-time setup", id: "Pengaturan pertama" },
  "login.firstSetupHint": {
    en: "Enter your Atlassian site URL, account email, and API token. Test the connection before signing in.",
    id: "Isi URL situs Atlassian, email akun, dan API token. Tes koneksi sebelum masuk.",
  },
  "login.testConnection": { en: "Test connection", id: "Tes koneksi" },
  "login.testingConnection": { en: "Testing connection…", id: "Menguji koneksi…" },
  "login.testShort": { en: "Test", id: "Tes" },
  "login.testingShort": { en: "Testing…", id: "Menguji…" },
  "login.connectionSuccess": { en: "Connection successful. Connected as {name}.", id: "Koneksi berhasil. Terhubung sebagai {name}." },

  // First-run onboarding
  "onboarding.step": { en: "Final setup", id: "Pengaturan akhir" },
  "onboarding.title": { en: "Set your working day", id: "Atur hari kerja kamu" },
  "onboarding.intro": {
    en: "These values set your daily target and the default time used for new worklogs.",
    id: "Nilai ini menentukan target harian dan waktu default untuk worklog baru.",
  },
  "onboarding.invalidHours": { en: "Check the target and working hours.", id: "Periksa target dan jam kerja." },
  "onboarding.invalidBreak": { en: "Break end must be later than its start.", id: "Jam istirahat selesai harus setelah jam mulai." },
  "onboarding.saving": { en: "Saving…", id: "Menyimpan…" },
  "onboarding.continue": { en: "Save and open workspace", id: "Simpan dan buka workspace" },
  "onboarding.changeLater": { en: "You can change these values later in Settings.", id: "Nilai ini dapat diubah lagi melalui Pengaturan." },

  // Header
  "header.auditLog": { en: "Audit log", id: "Catatan audit" },
  "header.sync": { en: "Sync", id: "Sync" },
  "header.syncing": { en: "Syncing…", id: "Menyinkronkan…" },
  "header.syncHint": { en: "Reload worklogs from Jira", id: "Muat ulang worklog dari Jira" },
  "header.syncSuccess": { en: "Worklogs synced with Jira.", id: "Worklog berhasil disinkronkan dengan Jira." },
  "header.syncFailed": { en: "Could not sync worklogs", id: "Gagal menyinkronkan worklog" },
  "header.syncQueueFailed": {
    en: "{n} queued worklog(s) could not be synced.",
    id: "{n} worklog dalam antrean gagal disinkronkan.",
  },
  "header.lastSync": { en: "Last: {time}", id: "Terakhir: {time}" },
  "header.neverSynced": { en: "Not synced yet", id: "Belum disinkronkan" },
  "update.restart": { en: "Restart app", id: "Buka ulang aplikasi" },
  "update.restartFailed": { en: "Update installed. Please restart the app.", id: "Update terpasang. Silakan buka ulang aplikasi." },
  "header.openAuditLog": { en: "Open audit log", id: "Buka catatan audit" },

  // Audit log
  "audit.title": { en: "Audit Log", id: "Catatan Audit" },
  "audit.close": { en: "Close audit log", id: "Tutup catatan audit" },
  "audit.filter": { en: "Filter audit log", id: "Saring catatan audit" },

  // Update
  "update.available": { en: "Version {v} available", id: "Versi {v} tersedia" },
  "update.installing": { en: "Installing version {v}…", id: "Memasang versi {v}…" },
  "update.failed": { en: "Update failed", id: "Gagal memasang update" },
  "update.willRestart": {
    en: "The app restarts once the update is installed.",
    id: "Aplikasi akan dimuat ulang setelah update dipasang.",
  },
  "update.action": { en: "Update", id: "Update" },
  "update.downloading": { en: "Downloading {n}…", id: "Mengunduh {n}…" },
  "update.releaseNotes": { en: "Release notes", id: "Catatan rilis" },
  "update.noReleaseNotes": {
    en: "No release notes were provided for this version.",
    id: "Tidak ada catatan rilis untuk versi ini.",
  },
  "update.updatedSuccess": {
    en: "Updated successfully to version {v}",
    id: "Berhasil diperbarui ke versi {v}",
  },
  "update.verified": {
    en: "The running application version has been verified.",
    id: "Versi aplikasi yang sedang berjalan telah diverifikasi.",
  },

  // Settings — shell
  "settings.title": { en: "Settings", id: "Pengaturan" },
  "settings.panelLabel": { en: "Workspace settings", id: "Pengaturan workspace" },
  "settings.close": { en: "Close settings", id: "Tutup pengaturan" },

  // Settings — Jira connection
  "settings.connection": { en: "Jira Connection", id: "Koneksi Jira" },
  "settings.deployment": { en: "Deployment", id: "Jenis Deployment" },
  "settings.deploymentLabel": { en: "Jira deployment", id: "Jenis deployment Jira" },
  "settings.cloud": { en: "Cloud", id: "Cloud" },
  "settings.server": { en: "Server", id: "Server" },
  "settings.emailPlaceholder": { en: "user@company.com", id: "nama@perusahaan.com" },
  "settings.aiDescription": { en: "AI Description Helper", id: "Bantuan Deskripsi AI" },
  "settings.aiDescriptionHint": { en: "Optional. Only the description text is sent when you choose to use it. Your API key stays in this device's secure key storage.", id: "Opsional. Hanya teks deskripsi yang dikirim saat kamu memilih menggunakannya. API key tersimpan di penyimpanan key aman perangkat ini." },
  "settings.aiEnable": { en: "Enable personal AI assistance", id: "Aktifkan bantuan AI pribadi" },
  "settings.aiProvider": { en: "Provider", id: "Provider" },
  "settings.aiProviderOpenai": { en: "OpenAI", id: "OpenAI" },
  "settings.aiProviderGemini": { en: "Google Gemini", id: "Google Gemini" },
  "settings.aiProviderClaude": { en: "Anthropic Claude", id: "Anthropic Claude" },
  "settings.aiProviderHint": { en: "Each provider has its own personal API key and billing.", id: "Setiap provider memakai API key dan tagihan pribadi masing-masing." },
  "settings.aiLanguage": { en: "Output language", id: "Bahasa hasil" },
  "settings.aiLanguageAuto": { en: "Match my note", id: "Sama dengan catatan" },
  "settings.aiLanguageId": { en: "Indonesian", id: "Indonesia" },
  "settings.aiLanguageEn": { en: "English", id: "Inggris" },
  "settings.aiApiKey": { en: "Personal API key", id: "API key pribadi" },
  "settings.aiApiKeySaved": { en: "Saved securely — enter a new key to replace it", id: "Tersimpan aman — masukkan key baru untuk menggantinya" },
  "settings.aiTest": { en: "Test API key", id: "Uji API key" },
  "settings.aiTesting": { en: "Testing…", id: "Menguji…" },
  "settings.aiTestHint": { en: "Sends one very short test request and may use a small amount of your provider quota. The key is not saved by this test.", id: "Mengirim satu permintaan tes yang sangat singkat dan mungkin memakai sedikit kuota provider. Key tidak disimpan oleh tes ini." },
  "settings.aiSave": { en: "Save AI settings", id: "Simpan pengaturan AI" },
  "settings.aiRemoveKey": { en: "Remove saved API key", id: "Hapus API key tersimpan" },

  // Settings — reminder & target
  "settings.reminder": { en: "Reminder", id: "Pengingat" },
  "settings.reminderEnable": {
    en: "Enable daily reminder",
    id: "Aktifkan pengingat harian",
  },
  "settings.reminderHour": { en: "Reminder hour (24h)", id: "Jam pengingat (24 jam)" },
  "settings.targetHours": { en: "Target Hours", id: "Target Jam" },
  "settings.dailyTarget": { en: "Daily target (hours)", id: "Target harian (jam)" },
  "settings.workdayStart": { en: "Workday starts", id: "Jam kerja mulai" },
  "settings.workdayEnd": { en: "Workday ends", id: "Jam kerja selesai" },

  // Settings — auto schedule
  "settings.autoSchedule": { en: "Auto Scheduling", id: "Penjadwalan Otomatis" },
  "settings.autoEnable": {
    en: "Enable auto scheduling",
    id: "Aktifkan penjadwalan otomatis",
  },
  "settings.activeDays": { en: "Active days", id: "Hari berlaku" },
  "settings.skipHolidays": {
    en: "Skip national holidays",
    id: "Lewati hari libur nasional",
  },
  "settings.catchUp": {
    en: "Also fill missed workdays",
    id: "Isi juga hari kerja yang terlewat",
  },
  "settings.catchUpMax": { en: "Maximum days back", id: "Maksimal hari ke belakang" },
  "settings.runAtLogin": {
    en: "Run at login & stay active in background",
    id: "Jalankan saat login & tetap aktif di background",
  },
  "settings.activities": { en: "Daily activities", id: "Kegiatan harian" },
  "settings.noActivities": {
    en: "No activities yet. Add at least one.",
    id: "Belum ada kegiatan. Tambahkan minimal satu.",
  },
  "settings.addActivity": { en: "+ Add activity", id: "+ Tambah kegiatan" },
  "settings.removeActivity": { en: "Remove activity", id: "Hapus kegiatan" },
  "settings.issueKey": { en: "Issue key", id: "Issue key" },
  "settings.hours": { en: "Hours", id: "Jam" },
  "settings.startTime": { en: "Start", id: "Mulai" },
  "settings.validFrom": { en: "Valid from", id: "Berlaku dari" },
  "settings.validUntil": { en: "Until", id: "Sampai" },
  "settings.descriptionOptional": {
    en: "Description (optional)",
    id: "Deskripsi (opsional)",
  },
  "settings.issueKeyPlaceholder": { en: "e.g. PROJ-123", id: "mis. PROJ-123" },
  "settings.workPlaceholder": {
    en: "What did you work on?",
    id: "Apa yang dikerjakan?",
  },

  // Settings — break
  "settings.break": { en: "Break Time", id: "Jam Istirahat" },
  "settings.breakEnable": {
    en: "Account for break time",
    id: "Perhitungkan jam istirahat",
  },
  "settings.breakStart": { en: "Start", id: "Mulai" },
  "settings.breakEnd": { en: "End", id: "Selesai" },
  "settings.breakFriday": { en: "End (Friday)", id: "Selesai (Jumat)" },

  // Settings — appearance & about
  "settings.appearance": { en: "Appearance", id: "Tampilan" },
  "settings.themeLabel": { en: "App theme", id: "Tema aplikasi" },
  "settings.themeAuto": { en: "Automatic", id: "Otomatis" },
  "settings.themeLight": { en: "Light", id: "Terang" },
  "settings.themeDark": { en: "Dark", id: "Gelap" },
  "settings.systemUsing": { en: "System is currently using", id: "Sistem sedang memakai tema" },
  "settings.about": { en: "About", id: "Tentang" },
  "settings.app": { en: "Application", id: "Aplikasi" },
  "settings.version": { en: "Version", id: "Versi" },
  "settings.author": { en: "Author", id: "Pembuat" },
  "settings.sourceCode": { en: "Source code", id: "Kode sumber" },
  "settings.checkUpdate": { en: "Check for updates", id: "Cek pembaruan" },
  "settings.checking": { en: "Checking…", id: "Mengecek…" },
  "settings.upToDate": { en: "You're on the latest version.", id: "Sudah versi terbaru." },
  "settings.updateFound": {
    en: "Version {v} available — see the banner in the bottom right.",
    id: "Versi {v} tersedia — lihat banner di kanan bawah.",
  },
  "settings.autoChecked": {
    en: "Updates are also checked automatically on every launch.",
    id: "Pembaruan juga dicek otomatis setiap kali aplikasi dibuka.",
  },

  // Log Work form
  "log.title": { en: "Log Work", id: "Catat Kerja" },
  "log.project": { en: "Project", id: "Project" },
  "log.projectList": { en: "Project list", id: "Daftar project" },
  "log.projectLoading": { en: "Loading projects…", id: "Memuat project…" },
  "log.projectNoMatch": {
    en: "No matching project.",
    id: "Tidak ada project yang cocok.",
  },
  "log.projectClear": {
    en: "Clear project filter (back to all projects)",
    id: "Hapus pilihan project (kembali ke semua project)",
  },
  "log.selected": { en: "Selected:", id: "Terpilih:" },
  "log.clearIssue": { en: "Clear selected issue", id: "Batalkan pilihan issue" },
  "log.hours": { en: "Hours", id: "Jam" },
  "log.days": { en: "Days", id: "Hari" },
  "log.hoursPart": { en: "Hours", id: "Jam" },
  "log.minutes": { en: "Minutes", id: "Menit" },
  "log.conversion": { en: "Conversion", id: "Konversi" },
  "log.decimalDay": { en: "day", id: "hari kerja" },
  "log.decimalDays": { en: "days", id: "hari kerja" },
  "log.decimalHour": { en: "hour", id: "jam" },
  "log.decimalHours": { en: "hours", id: "jam" },
  "log.totalMinute": { en: "minute", id: "menit" },
  "log.totalMinutes": { en: "minutes", id: "menit" },
  "log.dateStarted": { en: "Date started", id: "Waktu mulai" },
  "log.startTime": { en: "Start time", id: "Waktu mulai" },
  "log.dateToday": { en: "Today", id: "Hari ini" },
  "log.dateYesterday": { en: "Yesterday", id: "Kemarin" },
  "log.dateTwoDaysAgo": { en: "2 days ago", id: "2 hari lalu" },
  "log.dateShortcuts": { en: "Date shortcuts", id: "Pintasan tanggal" },
  "log.openCalendar": { en: "Open calendar", id: "Buka kalender" },
  "log.prevMonth": { en: "Previous month", id: "Bulan sebelumnya" },
  "log.nextMonth": { en: "Next month", id: "Bulan berikutnya" },
  "log.description": { en: "Description (optional)", id: "Deskripsi (opsional)" },
  "log.submitted": { en: "Worklog submitted", id: "Worklog terkirim" },
  "log.queued": { en: "Queued for sync", id: "Diantre untuk sinkronisasi" },
  "log.breakNotice": {
    en: "Crosses break time — {d} of work ends at {end}.",
    id: "Melewati jam istirahat — {d} kerja selesai pukul {end}.",
  },
  "log.durationHint": {
    en: "Enter hours and minutes. The conversion is calculated automatically. 5-minute steps, max 24 hours. 1 work day = {h} hours.",
    id: "Masukkan jam dan menit. Konversi dihitung otomatis. Kelipatan 5 menit, maksimal 24 jam. 1 hari kerja = {h} jam.",
  },

  // Search
  "search.title": { en: "Search issues", id: "Cari issue" },
  "search.placeholder": {
    en: "Search by issue key or summary",
    id: "Cari berdasarkan issue key atau ringkasan",
  },
  "search.results": { en: "Search results", id: "Hasil pencarian" },
  "search.noMatch": {
    en: "No issues match this query.",
    id: "Tidak ada issue yang cocok.",
  },
  "search.noEpics": {
    en: "This project has no Epics yet. Type to search other issues.",
    id: "Project ini belum punya Epic. Ketik untuk mencari issue lain.",
  },
  "search.noChildren": { en: "No child issues.", id: "Tidak ada child issue." },
  "search.recent": { en: "Recently used", id: "Terakhir dipakai" },
  "search.noRecent": {
    en: "No history yet. Type to search issues.",
    id: "Belum ada riwayat. Ketik untuk mencari issue.",
  },
  "search.formLoading": { en: "Loading form…", id: "Memuat form…" },
  "search.summary": { en: "Summary", id: "Ringkasan" },
  "search.taskType": { en: "Task type", id: "Tipe task" },
  "search.assignee": { en: "Assignee", id: "Ditugaskan ke" },
  "search.whatToDo": { en: "What needs doing?", id: "Apa yang ingin dikerjakan?" },
  "search.startTimer": { en: "Start timer", id: "Mulai timer" },

  // Calendar extras
  "calendar.title": { en: "Calendar", id: "Kalender" },
  "calendar.viewMode": { en: "Calendar view mode", id: "Mode tampilan kalender" },
  "calendar.groupBy": { en: "Group list", id: "Kelompokkan daftar" },
  "calendar.groupByDate": { en: "By date", id: "Per tanggal" },
  "calendar.groupByIssue": { en: "By issue", id: "Per issue" },
  "calendar.taskName": { en: "Task Name", id: "Nama Task" },
  "calendar.workReference": { en: "Work Reference", id: "Referensi Kerja" },
  "calendar.comment": { en: "Comment", id: "Komentar" },
  "calendar.entries": { en: "entries", id: "entri" },
  "calendar.draft": { en: "draft", id: "draf" },
  "calendar.editWorklog": { en: "Edit worklog", id: "Edit logwork" },
  "calendar.deleteWorklog": { en: "Delete worklog", id: "Hapus logwork" },
  "calendar.confirmDelete": {
    en: "Confirm worklog deletion",
    id: "Konfirmasi hapus logwork",
  },
  "calendar.clickToDelete": { en: "Click to delete", id: "Klik untuk menghapus" },
  "calendar.cancelDelete": { en: "Cancel deletion", id: "Batal hapus" },
  "calendar.confirmYes": { en: "Yes, delete", id: "Ya, hapus" },
  "calendar.addWorklog": { en: "Add worklog", id: "Tambah logwork" },

  // Staged changes bar
  "staged.discard": { en: "Discard", id: "Buang" },
  "staged.saving": { en: "Saving…", id: "Menyimpan…" },
  "staged.regionLabel": {
    en: "Unsaved calendar changes",
    id: "Perubahan kalender belum disimpan",
  },
  "staged.submit": { en: "Submit changes ({n})", id: "Simpan perubahan ({n})" },
  "staged.pendingEdits": {
    en: "{n} unsaved changes",
    id: "{n} perubahan belum disimpan",
  },
  "staged.pendingDrafts": {
    en: "{n} scheduled drafts — review then submit",
    id: "{n} draf jadwal otomatis — periksa lalu submit",
  },
  "staged.pendingBoth": {
    en: "{e} changes · {d} scheduled drafts",
    id: "{e} perubahan · {d} draf jadwal otomatis",
  },
  "staged.failed": {
    en: "Failed to save {n} changes. Please try again.",
    id: "Gagal menyimpan {n} perubahan. Silakan coba lagi.",
  },

  // Misc surfaces
  "misc.logWork": { en: "Log work", id: "Catat kerja" },
  "misc.loadingSummary": { en: "Loading summary", id: "Memuat ringkasan" },
  "misc.userMenu": { en: "User menu", id: "Menu pengguna" },
  "misc.setupIncomplete": {
    en: "Connection setup is incomplete. Open Settings to finish.",
    id: "Koneksi belum lengkap. Buka Pengaturan untuk melengkapinya.",
  },
  "misc.openSettings": { en: "Open Settings", id: "Buka Pengaturan" },
  "misc.targetReached": { en: "Target reached!", id: "Target tercapai!" },

  // Timer
  "timer.tracking": { en: "Tracking time:", id: "Sedang mencatat:" },
  "timer.pause": { en: "Pause", id: "Jeda" },
  "timer.resume": { en: "Resume", id: "Lanjut" },
  "timer.stopAndLog": { en: "Stop & Log Work", id: "Berhenti & Catat" },

  // Description editor
  "editor.bold": { en: "Bold", id: "Tebal" },
  "editor.italic": { en: "Italic", id: "Miring" },
  "editor.strike": { en: "Strikethrough", id: "Coret" },
  "editor.underline": { en: "Underline", id: "Garis bawah" },
  "editor.mono": { en: "Monospace", id: "Monospasi" },
  "editor.heading": { en: "Heading", id: "Judul" },
  "editor.bullets": { en: "Bulleted list", id: "Daftar butir" },
  "editor.numbers": { en: "Numbered list", id: "Daftar bernomor" },
  "editor.codeBlock": { en: "Code block", id: "Blok kode" },
  "editor.quote": { en: "Quote", id: "Kutipan" },
  "editor.divider": { en: "Divider", id: "Pemisah" },
  "editor.textStyle": { en: "Text style", id: "Gaya teks" },
  "editor.insertElement": { en: "Insert element", id: "Sisipkan elemen" },
  "editor.insertLink": { en: "Insert link", id: "Sisipkan link" },
  "editor.formatLabel": { en: "Format description", id: "Format deskripsi" },
  "editor.linkText": { en: "Text", id: "Teks" },
  "editor.linkLabel": { en: "Label (optional)", id: "Label (opsional)" },
  "editor.insert": { en: "Insert", id: "Sisipkan" },
  "editor.aiImprove": { en: "Improve work description with your personal AI", id: "Detailkan deskripsi kerja dengan AI pribadi" },
  "editor.aiImproveShort": { en: "Improve with AI", id: "Tingkatkan dengan AI" },
  "editor.aiImproving": { en: "Improving…", id: "Memproses…" },

  // Quick Log tray window
  "tray.loading": { en: "Loading…", id: "Memuat…" },
  "tray.needLogin": {
    en: "Open the main app and log in first.",
    id: "Buka aplikasi utama dan login terlebih dahulu.",
  },
  "tray.todayIs": { en: "Today:", id: "Hari ini:" },
  "tray.noTemplates": { en: "No templates yet.", id: "Belum ada template." },
  "tray.issue": { en: "Issue", id: "Issue" },
  "tray.searching": { en: "Searching…", id: "Mencari…" },
  "tray.recent": { en: "Recent:", id: "Terakhir:" },
  "tray.duration": { en: "Duration", id: "Durasi" },
  "tray.date": { en: "Date", id: "Tanggal" },
  "tray.description": { en: "Description", id: "Deskripsi" },
  "tray.running": { en: "Running…", id: "Berjalan…" },
  "tray.saveTemplate": { en: "Save as template", id: "Simpan sebagai template" },
  "tray.issuePlaceholder": {
    en: "Type an issue key or search…",
    id: "Ketik issue key atau cari…",
  },
  "tray.minutes": { en: "Minutes", id: "Menit" },

  // Sisa
  "editor.url": { en: "URL", id: "URL" },
  "editor.undo": { en: "Undo", id: "Urungkan" },
  "editor.redo": { en: "Redo", id: "Ulangi" },
  "login.loading": { en: "Loading…", id: "Memuat…" },
  "login.redirecting": {
    en: "Redirecting to your workspace…",
    id: "Mengalihkan ke workspace kamu…",
  },
  "lang.group": { en: "Language / Bahasa", id: "Bahasa / Language" },
  "lang.english": { en: "English", id: "Bahasa Inggris" },
  "lang.indonesian": { en: "Bahasa Indonesia", id: "Bahasa Indonesia" },
  "recent.title": { en: "Recent Issues", id: "Issue Terakhir" },
  "recent.empty": {
    en: "No recent issues. Use the search below to find one.",
    id: "Belum ada issue terakhir. Pakai pencarian di bawah.",
  },
  "chips.label": { en: "Hours to log", id: "Jam yang dicatat" },
  "unit.day": { en: "day", id: "hari" },
  "unit.hour": { en: "h", id: "jam" },
  "unit.minute": { en: "min", id: "menit" },

  // Hint paragraphs
  "settings.autoHint": {
    en: "Prepares drafts of recurring activities on the selected workdays. Drafts appear on the calendar for you to review and edit, then go to Jira via the \"Submit changes\" button — nothing is sent automatically. Runs while the app is open.",
    id: "Menyiapkan draf kegiatan berulang pada hari kerja terpilih. Draf tampil di kalender untuk kamu periksa & ubah dulu, lalu dikirim ke Jira lewat tombol \"Submit changes\" — tidak ada yang terkirim otomatis. Berjalan saat aplikasi dibuka.",
  },
  "settings.autostartHint": {
    en: "The app opens automatically (hidden in the tray) when you log in, so scheduling runs without opening it manually. Closing the window hides it to the tray — quit fully from the tray menu.",
    id: "Aplikasi dibuka otomatis (tersembunyi di tray) saat kamu login, sehingga penjadwalan berjalan tanpa perlu dibuka manual. Menutup jendela akan menyembunyikan ke tray — keluar penuh lewat menu tray.",
  },
  "settings.breakHint": {
    en: "The duration you enter counts as work hours. Break time does not reduce it — it shifts the end time. Starting at 09:00 for 8 hours means finishing at 18:00, and on the calendar the block splits with the break left clear.",
    id: "Durasi yang kamu isi dihitung sebagai jam kerja. Jam istirahat tidak memotongnya — ia menggeser jam selesai. Mulai 09:00 selama 8 jam berarti selesai pukul 18:00, dan di kalender bloknya terbagi dengan jam istirahat tetap bersih.",
  },
  "settings.breakFridayHint": {
    en: "Leave the Friday field empty if the break is the same as other days. Weekends are never affected.",
    id: "Kosongkan kolom Jumat kalau jam istirahatnya sama dengan hari lain. Akhir pekan tidak pernah dipotong.",
  },
  "settings.themeHint": {
    en: "\"Automatic\" follows the operating system theme and switches instantly when the system setting changes.",
    id: "\"Otomatis\" mengikuti tema sistem operasi dan ikut berubah seketika saat pengaturan sistem diubah.",
  },
};

/**
 * Translate a key for the current language; falls back to the key itself so
 * a missing translation is visible rather than blank.
 *
 * `params` mengisi placeholder `{nama}` di dalam string. Interpolasi
 * dilakukan di sini, bukan dengan merangkai potongan kalimat di komponen,
 * karena urutan kata berbeda antar bahasa — "Version 2 available" tidak
 * bisa disusun dari potongan yang sama dengan "Versi 2 tersedia".
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const entry = DICT[key];
  const text = entry ? entry[current] : key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    name in params ? String(params[name]) : whole,
  );
}
