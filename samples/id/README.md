# Test audio — Bahasa Indonesia

Dibuat secara luring dengan `say` (suara **Damayanti**, `id_ID`) bawaan macOS +
`afconvert`/`ffmpeg`. Tarik salah satu berkas ke dalam aplikasi untuk menguji
transkripsi. (Transkripsi butuh model yang sudah diunduh dulu — pilih di tampilan
**Models**; `large-v3-turbo` adalah default.)

| Berkas | Panjang | Menguji |
|--------|--------|---------|
| `id-short.m4a` | 18s | Uji cepat end-to-end, m4a |
| `id-short.mp3` | 18s | Format mp3 |
| `id-medium.m4a` | 33s | Paragraf, batas kalimat |
| `id-medium-noisy.m4a` | 33s | Ketahanan terhadap derau latar |
| `id-long.m4a` | 108s | Multi-paragraf, ketahanan |

Di tampilan Home, set **Language** ke **Indonesian** (atau biarkan **Auto-detect**)
sebelum menjatuhkan berkas.

## Transkrip acuan (teks yang diucapkan)

### id-short
> Selamat datang di Transcriptor. Ini adalah rekaman uji coba singkat. Bagian
> satu: seekor rubah cokelat cepat melompati anjing yang malas. Bagian dua:
> menguji penanda waktu pada detik ketiga dan detik ketujuh. Akhir dari uji coba
> singkat.

### id-medium
> Selamat datang kembali di acara ini. Hari ini kita membahas pembelajaran mesin
> yang berjalan di perangkat Anda dan mengapa privasi itu penting. Semua yang
> Anda rekam di sini tetap berada di mesin Anda sendiri. Tidak ada satu pun yang
> diunggah, dibatasi, atau dipotong. Bahkan rekaman sepanjang empat jam bisa
> ditranskripsi sampai selesai. Dan penanda waktu akan selaras persis dengan
> video Anda. Itulah intinya: transkripsi yang akurat, privat, dan luring.

### id-medium-noisy
Teks sama dengan `id-medium`, dicampur dengan derau pink taraf rendah (~6%).

### id-long
> Ini adalah rekaman uji coba yang lebih panjang untuk memeriksa bagaimana
> Transcriptor menangani berkas dengan banyak paragraf. Selamat datang di
> podcast transkripsi luring, episode pertama. Dalam episode ini kita membahas
> apa artinya menjalankan model pengenalan suara sepenuhnya di perangkat keras
> Anda sendiri. Pertama, mari kita bicara tentang privasi. Ketika audio tidak
> pernah meninggalkan mesin Anda, tidak ada risiko penyedia cloud menyimpan
> rekaman Anda, melatih model dengan data Anda, atau membocorkannya dalam
> insiden keamanan. Berkas yang Anda masukkan adalah berkas yang ditranskripsi,
> dan transkripnya hanya tersimpan di disk Anda. Kedua, akurasi. Model
> pengenalan suara modern bisa menranskripsi lebih dari sembilan puluh sembilan
> bahasa dan mendeteksi bahasa yang digunakan dari beberapa detik pertama
> audio. Model menghasilkan penanda waktu yang akurat, sehingga takarir Anda
> tetap selaras dengan video, detik demi detik, bahkan untuk kuliah sepanjang
> empat jam. Ketiga, keandalan. Tidak ada kuota bulanan, tidak ada biaya per
> menit, dan tidak ada batas panjang berkas. Anda bisa menranskripsi seluruh
> konferensi, pergi sebentar, dan kembali ke transkrip yang sudah selesai.
> Terakhir, catatan tentang kepercayaan. Sumber terbuka berarti Anda bisa membaca
> setiap baris kode yang menyentuh audio Anda. Tanpa telemetri, tanpa analitik,
> tanpa pelacakan. Itulah janji komputasi di perangkat, dan itulah alasan kami
> membuat Transcriptor. Terima kasih sudah mendengarkan.