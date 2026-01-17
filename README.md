Bu proje, bir turizm işletmesi olan Jolly Tur için geliştirilen sunucu taraflı bir karar destek sistemi uygulamasıdır.
Amaç; yöneticilerin tur, kampanya, rezervasyon ve müşteri verileri üzerinden analitik içgörüler elde edebilmesini sağlamaktır.
Uygulama; Node.js + Express kullanılarak geliştirilmiş olup, MVC mimarisine uygun bir yapıdadır.

Senaryo Tanımı:
Jolly Tur yönetimi
-Hangi tur türlerinin daha fazla talep gördüğünü,
-Kampanyaların kârlılık ve doluluk üzerindeki etkisini,
-Aylık kâr değişimlerini,
-Riskli (düşük doluluklu) turları,
-Anket verileri üzerinden müşteri davranışlarını
analiz edebilir.

Bazı İş Kuralları:
- Bir turun kapasitesi dolduğunda, o tura ait yeni rezervasyon oluşturulması engellenir. Bu iş kuralı sayesinde gerçekçi doluluk oranı korunur ve aşırı satış (overbooking) önlenir.
- Başlangıç ve bitiş tarihi dışında kalan kampanyalar geçersiz kabul edilir. Geçersiz kampanyalarla rezervasyon yapılmasına sistem tarafından izin verilmez.
