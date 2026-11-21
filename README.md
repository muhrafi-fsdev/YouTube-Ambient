# YouTube Ambient Glass

Ekstensi Chrome dari **Akira Keiji** yang memperpanjang gambar video YouTube ke ruang kosong di tepi player. Rasio video, subtitle, dan kontrol player tetap mengikuti tampilan YouTube.

## Pasang di Chrome

1. Unduh repo lewat **Code → Download ZIP**, lalu ekstrak.
2. Buka `chrome://extensions` dan aktifkan **Developer mode**.
3. Klik **Load unpacked**, lalu pilih folder yang berisi `manifest.json`.
4. Muat ulang tab YouTube yang sudah terbuka. Buka popup ekstensi melalui ikon Extensions di toolbar.

## Pengaturan

- **Kecerahan Ambient** mengatur terang gambar tepi. **Intensitas Ambient** mengatur seberapa kuat isian terlihat. **Transparansi Panel** mengatur latar rekomendasi, deskripsi, dan komentar.
- Di Mode Teater dan fullscreen YouTube, isian bisa menjangkau keempat tepi. **Flip isian tepi** memiliki lima pilihan dari searah video hingga flip horizontal dan vertikal.
- Ambient statis menahan satu frame. Jika **Gerakkan ambient** aktif, FPS dapat mengikuti video hingga 60 FPS atau dibatasi ke 30 atau 24 FPS. Frekuensi turun bila pemrosesan terlalu berat. Setelan **Kurangi Gerakan** dari sistem mempertahankan ambient statis.
- **Pendar tepi fullscreen** menambahkan cahaya tipis saat video sudah memenuhi layar. **Off** melepaskan tampilan yang diterapkan ekstensi dan **Reset** mengembalikan setelan awal.

Jika akses frame dibatasi, panel tetap semi-transparan. Pada mode bergerak, Ambient Mode bawaan YouTube bisa tampil jika sudah aktif. Pengaturan dan pemrosesan frame tetap lokal di browser.
