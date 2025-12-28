const db = require('../db');

exports.getTourTypeStats = (req, res) => {
  const sql = `
    SELECT tur_turu, COUNT(*) AS toplam
    FROM turlar
    GROUP BY tur_turu
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Veri alınamadı' });
    }
    res.json(results);
  });
};
