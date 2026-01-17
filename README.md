Bu proje, turizm işletmesi olan Jolly Tur için geliştirilen bir karar destek sistemi uygulamasıdır.
Amaç; yöneticilerin tur, kampanya, rezervasyon ve müşteri verileri üzerinden analitik içgörüler elde edebilmesini sağlamaktır.
Uygulama; Node.js + Express kullanılarak geliştirilmiş olup, MVC mimarisine uygun bir yapıdadır.

Proje Açıklaması:
Jolly Tur yönetimi; hangi tur türlerinin daha fazla talep gördüğünü, kampanyaların kârlılık ve doluluk üzerindeki etkisini, aylık kâr değişimlerini, riskli (düşük doluluklu) turları, anket verileri üzerinden müşteri davranışlarını analiz edebilir.

Kurulum Adımları:
-Sistemde Node.js ve MySQL kurulu olmalıdır.
-MySQL üzerinde proje için bir veritabanı oluşturulmalıdır (Örnek: jolly_tur).
-Proje dizininde .env.example dosyası kopyalanarak .env dosyası oluşturulmalıdır.
-Proje backend dizinine girilerek gerekli bağımlılıklar yüklenmelidir.
-Sunucu aşağıdaki komut ile başlatılmalıdır.
node server.js
-Sunucu çalıştıktan sonra: "http://localhost:3000" ile erişim sağlanabilir.

İş Kuralları:
- Bir turun kapasitesi dolduğunda, o tura ait yeni rezervasyon oluşturulması engellenir. Bu iş kuralı sayesinde gerçekçi doluluk oranı korunur ve aşırı satış (overbooking) önlenir.
- Başlangıç ve bitiş tarihi dışında kalan kampanyalar geçersiz kabul edilir. Geçersiz kampanyalarla rezervasyon yapılmasına sistem tarafından izin verilmez.

Bazı Endpoint'ler:
-POST /api/login
-GET /api/kpi/monthly-profit
-GET /api/tour-analysis/by-type
-GET /api/tour-duration-analysis
-GET /api/kampanya-karsilastirma
-GET /api/campaign-occupancy-comparison-table
-GET /api/campaign-whatif-discount
-GET /api/alerts/critical-occupancy
-GET /api/analytics/age-campaign-sensitivity
-GET /api/anket/aktivite-tercihleri
