# YouTube Ambient Glass

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](player.js)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](popup.html)
[![CSS](https://img.shields.io/badge/CSS-663399?logo=css&logoColor=white)](player.css)
[![Versi 1.9.0](https://img.shields.io/badge/version-1.9.0-2563EB)](manifest.json)
[![Chrome 120+](https://img.shields.io/badge/chrome-120%2B-4285F4?logo=googlechrome&logoColor=white)](manifest.json)

Ekstensi Chrome dari [**Muhammad Rafi Priyo**](https://github.com/muhrafi-fsdev) yang memperpanjang gambar video YouTube ke ruang kosong di tepi player. Rasio video, subtitle, dan kontrol player tetap mengikuti tampilan YouTube.

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
