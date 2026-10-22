NINJASAGA BOT - NSCC
cc: MagnetScript(Razki)
==========================================================

CARA PAKAI (Windows)
1. Install Node.js LTS sekali saja: https://nodejs.org/en/download
   (pilih Windows Installer .msi, next-next-finish)
2. Extract semua file zip ini ke satu folder, misal  C:\nscc
3. Klik dua kali  nscc.bat
4. Masukkan username + password NinjaSaga (hanya disimpan di memori
   sesi, tidak ditulis ke file)
5. Pilih menu 0-8

MENU
1. Jatah harian + naik level
   - masukkan target level (20 / 40 / 60 / 80 / 100)
   - urutan: Special Event (Kage, Halloween) -> TP -> SS -> Hunting
     -> misi level tertinggi yang sudah terbuka -> ujian otomatis
   - kalau semua sumber XP habis, bot TIDAK berhenti: tunggu 10 menit
     lalu coba lagi, terus sampai target level tercapai
   - ujian Chunin / Jounin / Special Jounin / Sennin jalan otomatis
   - lv 80 = Sennin Exam 12 misi (mode hard)

2. Event battle
   - Halloween: pakai heart, otomatis berhenti kalau heart habis
   - Tengu Goblin / Kage Apprenticeship: pakai energy, otomatis
     berhenti kalau energy habis

3. TP Training + SS Training
   - TP : msn170-msn174, 10 TP + 2.000 XP + 2.000 gold per misi
   - SS : msn279-msn283, 30 SS + 10.000 XP + 10.000 gold per misi
   - SS otomatis dilewati kalau misinya sudah beres hari itu

4. Hunting House / Eudemon
   - 1 = lihat daftar 10 room (rank C..S, boss, XP, gold)
   - 2 = auto jalan semua room (server: limit 1x per room per hari)

5. Cek karakter: level, XP, gold, daftar misi yang sudah lewat
6. Ganti akun
7. Daftar misi per grade (E/D/C/S) + status siap/selesai
8. MISI SAJA - tanpa event, hunting, training (ujian tetap otomatis)
   - masukkan TARGET LEVEL (kosong = 100)
   - grade dipilih otomatis: bot ambil misi level tertinggi yang sudah
     terbuka, diulang selama server masih memberi reward
   - setiap naik level, bot cek ulang misi baru yang terbuka, lalu lanjut
   - ujian Chunin (lv20), Jounin (lv40), Special Jounin (lv60),
     Sennin (lv80) jalan sendiri begitu level menyentuh ambangnya
   - berhenti kalau target tercapai, atau 3 misi berturut-turut balas XP 0
     (artinya reward akun kosong, bukan salah pilih misi)
   - dipakai kalau mau farming misi tanpa menunggu event/hunting

   Opsional dari CMD (kalau mau batasi grade / jumlah misi):
     node ns_level.js 60 8 --only-mission
     node ns_level.js 60 8 --only-mission --grade B --max 20

LABEL GRADE (sesuai menu game)
   Grade A = misi level 42-78
   Grade B = misi level 20-39
   Grade C = misi level 1-19
   Grade S = misi khusus, biaya 75 energy (bukan grade dari level)
   Kalau level kamu 36, grade kamu B. Bot otomatis ambil misi level
   tertinggi yang terbuka, jadi tidak perlu pilih grade manual.

HUNTING HOUSE & EVENT BATTLE
   Hunting House: 1x per room per hari. Kalau sudah dipakai, server balas
   "Daily limit reached" dan bot lanjut ke room berikutnya. Room rank A/S
   baru terbuka di level tinggi (butuh lv 75-85).
   Event battle (Kage/Halloween): tiap battle memotong energy/heart.
   Kage 10 energy per battle, Halloween 1 heart per battle. Kalau sisa
   resource kurang, bot berhenti sendiri dan lapor sisa terakhir.
0. Keluar

KALAU MISI HARIAN REWARD 0
   Misi grade bisa dikerjakan berkali-kali, tapi tiap misi punya batas
   reward per hari. Kalau satu misi balas XP +0, itu jatahnya habis untuk
   hari ini — besok dibayar lagi. Bot otomatis pindah ke misi lain, bukan
   berhenti, dan misi yang belum bayar diistirahatkan 20 menit.
   Tes satu misi saja (buat cek misi masih bayar atau tidak):
     node ns_level.js 40 6 --one msn79
- Server kadang membalas "diterima" tapi XP +0. Penyebabnya:
  a. misi levelnya jauh di bawah level karakter (reward diskalakan ke 0)
  b. jatah reward harian akun sudah habis
- Bot versi ini hanya ambil misi harian yang levelnya maksimal 6 level
  di bawah karakter, dan menandai misi ber-reward 0 supaya tidak diulang
  terus.
- Kalau SEMUA misi (termasuk misi grade) balas XP +0 di satu sesi, itu
  bukan bug pemilihan misi: reward akun sedang kosong. Coba lagi setelah
  reset harian, atau pakai menu 2 (event) / menu 4 (hunting).

MANUAL (kalau mau jalankan per script dari CMD)
  set NS_USER=username
  set NS_PASS=password
  node ns_level.js 100 8 --only-mission --max 15
  node ns_level.js 100 8 --only-mission --grade C --max 20
  node ns_level.js 80 20
  node ns_event.js all 20
  node ns_train.js tp 5 20
  node ns_train.js ss 5 20
  node ns_hunt.js
  node ns_state.js
  node ns_mission.js C

CATATAN
- Butuh koneksi internet stabil.
- Jeda misi default 8 detik, misi bergrade dapat jeda tambahan 15 detik.
- Pemakaian bot melanggar ToS NinjaSaga. Pakai dengan risiko sendiri,
  idealnya di akun sekunder.

cc: MagnetScript(Razki)
