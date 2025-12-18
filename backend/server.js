const express = require('express');
const cors = require('cors');
const path = require('path');
const { testConnection, pool } = require('./db');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes (must be before static files)
// Health check endpoint
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  // Hardcoded credentials (as specified)
  const validUsername = 'Cansu';
  const validPassword = '123';

  if (username === validUsername && password === validPassword) {
    res.json({
      success: true,
      message: 'Login successful'
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Invalid username or password'
    });
  }
});

// KPI Overview endpoint
app.get('/api/kpi/overview', async (req, res) => {
  try {
    // Get total customers
    const [customersResult] = await pool.query('SELECT COUNT(*) as count FROM musteriler');
    const totalCustomers = customersResult[0].count;

    // Get total reservations
    const [reservationsResult] = await pool.query('SELECT COUNT(*) as count FROM rezervasyon');
    const totalReservations = reservationsResult[0].count;

    // Get total tours
    const [toursResult] = await pool.query('SELECT COUNT(*) as count FROM turlar');
    const totalTours = toursResult[0].count;

    // Get distinct survey participants (assuming anket_musteri has a customer reference)
    // Using COUNT(DISTINCT) to count unique participants
    const [surveyResult] = await pool.query('SELECT COUNT(DISTINCT musteri_id) as count FROM anket_musteri');
    const surveyParticipants = surveyResult[0].count;

    // Calculate participation rate
    const surveyParticipationRate = totalCustomers > 0 
      ? ((surveyParticipants / totalCustomers) * 100).toFixed(2)
      : 0;

    res.json({
      totalCustomers,
      totalReservations,
      totalTours,
      surveyParticipants,
      surveyParticipationRate: parseFloat(surveyParticipationRate)
    });
  } catch (error) {
    console.error('Error fetching KPI data:', error);
    res.status(500).json({
      error: 'Failed to fetch KPI data',
      message: error.message
    });
  }
});

// Monthly Profit KPI endpoint
app.get('/api/kpi/monthly-profit', async (req, res) => {
  try {
    // Calculate total profit from last 1 month
    // Using DATE_SUB to get records from the last 30 days
    const [profitResult] = await pool.query(
      `SELECT COALESCE(SUM(kar), 0) as monthlyProfit 
       FROM rezervasyon 
       WHERE rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)`
    );
    
    const monthlyProfit = parseFloat(profitResult[0].monthlyProfit) || 0;

    res.json({
      monthlyProfit
    });
  } catch (error) {
    console.error('Error fetching monthly profit data:', error);
    res.status(500).json({
      error: 'Failed to fetch monthly profit data',
      message: error.message
    });
  }
});

// Monthly Insights endpoint
app.get('/api/kpi/monthly-insights', async (req, res) => {
  try {
    // Get last month date range (current month - 1 month to current month)
    // Get previous month date range (current month - 2 months to current month - 1 month)
    
    // Last month reservations count
    const [lastMonthReservations] = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(kar), 0) as totalProfit 
       FROM rezervasyon 
       WHERE rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) 
       AND rezervasyon_tarihi < CURDATE()`
    );
    
    // Previous month reservations count
    const [prevMonthReservations] = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(kar), 0) as totalProfit 
       FROM rezervasyon 
       WHERE rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH) 
       AND rezervasyon_tarihi < DATE_SUB(CURDATE(), INTERVAL 1 MONTH)`
    );

    const lastMonthCount = parseInt(lastMonthReservations[0].count) || 0;
    const prevMonthCount = parseInt(prevMonthReservations[0].count) || 0;
    const lastMonthProfit = parseFloat(lastMonthReservations[0].totalProfit) || 0;
    const prevMonthProfit = parseFloat(prevMonthReservations[0].totalProfit) || 0;

    // Calculate reservation change percentage
    let reservationChangePercent = 0;
    if (prevMonthCount > 0) {
      reservationChangePercent = ((lastMonthCount - prevMonthCount) / prevMonthCount) * 100;
    } else if (lastMonthCount > 0) {
      reservationChangePercent = 100; // 100% increase if no previous data
    }

    // Calculate average profit per reservation
    const lastMonthAvgProfit = lastMonthCount > 0 ? lastMonthProfit / lastMonthCount : 0;
    const prevMonthAvgProfit = prevMonthCount > 0 ? prevMonthProfit / prevMonthCount : 0;

    // Calculate average profit change percentage
    let averageProfitChangePercent = 0;
    if (prevMonthAvgProfit > 0) {
      averageProfitChangePercent = ((lastMonthAvgProfit - prevMonthAvgProfit) / prevMonthAvgProfit) * 100;
    } else if (lastMonthAvgProfit > 0) {
      averageProfitChangePercent = 100; // 100% increase if no previous data
    }

    // Get campaign reservation rate for last month
    const [campaignReservations] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM rezervasyon 
       WHERE rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) 
       AND rezervasyon_tarihi < CURDATE()
       AND kampanya_id IS NOT NULL`
    );

    const campaignCount = parseInt(campaignReservations[0].count) || 0;
    const campaignReservationRate = lastMonthCount > 0 
      ? (campaignCount / lastMonthCount) * 100 
      : 0;

    res.json({
      reservationChangePercent: parseFloat(reservationChangePercent.toFixed(2)),
      averageProfitChangePercent: parseFloat(averageProfitChangePercent.toFixed(2)),
      campaignReservationRate: parseFloat(campaignReservationRate.toFixed(2))
    });
  } catch (error) {
    console.error('Error fetching monthly insights data:', error);
    res.status(500).json({
      error: 'Failed to fetch monthly insights data',
      message: error.message
    });
  }
});

// Home Highlights endpoint (Bu Ayın Öne Çıkan Turları)
app.get('/api/home/featured-tours', async (req, res) => {
  try {
    // En Karlı Tur: Bu ay (son 1 ay) rezervasyonlardan tur bazında toplam kârı en yüksek olan
    const [profitRows] = await pool.query(
      `SELECT t.tur_id, t.tur_adi, COALESCE(SUM(r.kar), 0) AS toplam_kar
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
       GROUP BY t.tur_id, t.tur_adi
       ORDER BY toplam_kar DESC
       LIMIT 1`
    );

    const topProfitableTour = profitRows[0]
      ? {
          turId: profitRows[0].tur_id,
          turAdi: profitRows[0].tur_adi,
          toplamKar: parseFloat(profitRows[0].toplam_kar) || 0
        }
      : null;

    // En Riskli Tur: Bu ay (son 1 ay) rezervasyonu olan turlar içinde ortalama doluluk oranı en düşük olan
    const [riskRows] = await pool.query(
      `SELECT t.tur_id, t.tur_adi, COALESCE(AVG(t.doluluk_orani), 0) AS ortalama_doluluk
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
       GROUP BY t.tur_id, t.tur_adi
       ORDER BY ortalama_doluluk ASC
       LIMIT 1`
    );

    let riskiestTour = riskRows[0]
      ? {
          turId: riskRows[0].tur_id,
          turAdi: riskRows[0].tur_adi,
          ortalamaDoluluk: parseFloat(riskRows[0].ortalama_doluluk) || 0
        }
      : null;

    // Fallback: Eğer bu ay rezervasyonu yoksa, tüm turlar içinde doluluk_orani en düşük olanı getir
    if (!riskiestTour) {
      const [fallbackRows] = await pool.query(
        `SELECT tur_id, tur_adi, COALESCE(doluluk_orani, 0) AS ortalama_doluluk
         FROM turlar
         ORDER BY doluluk_orani ASC
         LIMIT 1`
      );
      riskiestTour = fallbackRows[0]
        ? {
            turId: fallbackRows[0].tur_id,
            turAdi: fallbackRows[0].tur_adi,
            ortalamaDoluluk: parseFloat(fallbackRows[0].ortalama_doluluk) || 0
          }
        : null;
    }

    res.json({
      topProfitableTour,
      riskiestTour
    });
  } catch (error) {
    console.error('Error fetching home featured tours:', error);
    res.status(500).json({
      error: 'Failed to fetch home featured tours',
      message: error.message
    });
  }
});

// Critical Occupancy Alerts endpoint
app.get('/api/alerts/critical-occupancy', async (req, res) => {
  try {
    // Get tours with doluluk_orani <= 55
    const [tours] = await pool.query(
      `SELECT tur_id, tur_adi, doluluk_orani 
       FROM turlar 
       WHERE doluluk_orani <= 55 
       ORDER BY doluluk_orani ASC`
    );

    // Categorize tours by alert level
    const alerts = tours.map(tour => {
      const dolulukOrani = parseFloat(tour.doluluk_orani) || 0;
      let alertLevel = '';
      
      if (dolulukOrani >= 0 && dolulukOrani <= 40) {
        alertLevel = 'critical'; // RED
      } else if (dolulukOrani > 40 && dolulukOrani <= 55) {
        alertLevel = 'warning'; // YELLOW
      }

      return {
        tourId: tour.tur_id,
        tourName: tour.tur_adi,
        dolulukOrani: dolulukOrani,
        alertLevel: alertLevel
      };
    });

    res.json({
      alerts: alerts
    });
  } catch (error) {
    console.error('Error fetching critical occupancy alerts:', error);
    res.status(500).json({
      error: 'Failed to fetch critical occupancy alerts',
      message: error.message
    });
  }
});

// Tour Analysis by Type endpoint - Reservations per Tour Type
app.get('/api/tour-analysis/by-type', async (req, res) => {
  try {
    // Get reservation count per tour type
    const [results] = await pool.query(
      `SELECT t.tur_turu, COUNT(r.rezervasyon_id) AS rezervasyon_sayisi
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       GROUP BY t.tur_turu
       ORDER BY rezervasyon_sayisi DESC`
    );

    const tourTypes = results.map(row => ({
      turTuru: row.tur_turu,
      rezervasyonSayisi: parseInt(row.rezervasyon_sayisi)
    }));

    res.json({
      tourTypes: tourTypes
    });
  } catch (error) {
    console.error('Error fetching tour analysis by type:', error);
    res.status(500).json({
      error: 'Failed to fetch tour analysis by type',
      message: error.message
    });
  }
});

// Tour Analysis Average Occupancy by Type endpoint
app.get('/api/tour-analysis/avg-occupancy-by-type', async (req, res) => {
  try {
    // Get average occupancy per tour type
    const [results] = await pool.query(
      `SELECT tur_turu, AVG(doluluk_orani) AS ortalama_doluluk
       FROM turlar
       GROUP BY tur_turu
       ORDER BY ortalama_doluluk DESC`
    );

    const tourTypes = results.map(row => ({
      turTuru: row.tur_turu,
      ortalamaDoluluk: parseFloat(row.ortalama_doluluk) || 0
    }));

    res.json({
      tourTypes: tourTypes
    });
  } catch (error) {
    console.error('Error fetching average occupancy by type:', error);
    res.status(500).json({
      error: 'Failed to fetch average occupancy by type',
      message: error.message
    });
  }
});

// Tours list endpoint (for dropdown options)
app.get('/api/tours', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT tur_id, tur_adi
       FROM turlar
       ORDER BY tur_adi ASC`
    );

    res.json({
      tours: rows.map(r => ({
        turId: r.tur_id,
        turAdi: r.tur_adi
      }))
    });
  } catch (error) {
    console.error('Error fetching tours list:', error);
    res.status(500).json({
      error: 'Failed to fetch tours list',
      message: error.message
    });
  }
});

// Tour detail endpoint (for comparison table)
app.get('/api/tours/:turId', async (req, res) => {
  try {
    const turId = req.params.turId;
    if (!turId) {
      return res.status(400).json({ error: 'turId is required' });
    }

    // Detect column names safely (do not assume schema changes)
    const [colRows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?`,
      ['turlar']
    );

    const cols = new Set(colRows.map(r => String(r.COLUMN_NAME)));
    const pick = (candidates) => candidates.find(c => cols.has(c)) || null;

    const fiyatCol = pick(['fiyat', 'tur_fiyati', 'ucret', 'tur_ucreti', 'fiyat_tl']);
    const kapasiteCol = pick(['kapasite', 'kontenjan', 'kisi_sayisi', 'max_kapasite']);
    // Süre (gün) alanı: turlar.tur_gunu (istenen kolon)
    // (Diğer olası kolon adlarını da geriye dönük uyumluluk için listede tutuyoruz.)
    const sureCol = pick(['tur_gunu', 'sure_gun', 'sure', 'tur_suresi', 'gun_sayisi']);

    const selectParts = [
      '`tur_id` AS tur_id',
      '`tur_adi` AS tur_adi',
      (fiyatCol ? `\`${fiyatCol}\` AS fiyat` : 'NULL AS fiyat'),
      (kapasiteCol ? `\`${kapasiteCol}\` AS kapasite` : 'NULL AS kapasite'),
      '`doluluk_orani` AS doluluk_orani',
      (sureCol ? `\`${sureCol}\` AS sure_gun` : 'NULL AS sure_gun')
    ];

    const [rows] = await pool.query(
      `SELECT ${selectParts.join(', ')}
       FROM turlar
       WHERE tur_id = ?
       LIMIT 1`,
      [turId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Tur bulunamadı' });
    }

    const t = rows[0];
    res.json({
      tur: {
        turId: t.tur_id,
        turAdi: t.tur_adi,
        fiyat: t.fiyat === null ? null : Number(t.fiyat),
        kapasite: t.kapasite === null ? null : Number(t.kapasite),
        dolulukOrani: t.doluluk_orani === null ? null : Number(t.doluluk_orani),
        sureGun: t.sure_gun === null ? null : Number(t.sure_gun)
      }
    });
  } catch (error) {
    console.error('Error fetching tour detail:', error);
    res.status(500).json({
      error: 'Failed to fetch tour detail',
      message: error.message
    });
  }
});

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// Start server
async function startServer() {
  // Test database connection on startup
  await testConnection();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
