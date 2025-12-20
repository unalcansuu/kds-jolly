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

// Tour Analysis Leaders endpoint (for dynamic analytical evaluation)
app.get('/api/tour-analysis/leaders', async (req, res) => {
  try {
    // Get tour type with highest reservation count
    const [reservationLeader] = await pool.query(
      `SELECT t.tur_turu, COUNT(r.rezervasyon_id) AS rezervasyon_sayisi
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       GROUP BY t.tur_turu
       ORDER BY rezervasyon_sayisi DESC
       LIMIT 1`
    );

    // Get tour type with highest average occupancy rate
    const [occupancyLeader] = await pool.query(
      `SELECT tur_turu, AVG(doluluk_orani) AS ortalama_doluluk
       FROM turlar
       GROUP BY tur_turu
       ORDER BY ortalama_doluluk DESC
       LIMIT 1`
    );

    const reservationLeaderData = reservationLeader[0] ? {
      turTuru: reservationLeader[0].tur_turu,
      rezervasyonSayisi: parseInt(reservationLeader[0].rezervasyon_sayisi)
    } : null;

    const occupancyLeaderData = occupancyLeader[0] ? {
      turTuru: occupancyLeader[0].tur_turu,
      ortalamaDoluluk: parseFloat(occupancyLeader[0].ortalama_doluluk) || 0
    } : null;

    res.json({
      reservationLeader: reservationLeaderData,
      occupancyLeader: occupancyLeaderData
    });
  } catch (error) {
    console.error('Error fetching tour analysis leaders:', error);
    res.status(500).json({
      error: 'Failed to fetch tour analysis leaders',
      message: error.message
    });
  }
});

// Tour Duration Insights (tur_gunu grouped into 1–2 / 3–5 / 6+)
app.get('/api/tour-duration-insights', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.sure_grubu,
              COALESCE(a.rezervasyon_sayisi, 0) AS rezervasyon_sayisi,
              COALESCE(a.tur_sayisi, 0) AS tur_sayisi
       FROM (
         SELECT '1–2 Gün' AS sure_grubu
         UNION ALL SELECT '3–5 Gün'
         UNION ALL SELECT '6+ Gün'
       ) g
       LEFT JOIN (
         SELECT
           CASE
             WHEN t.tur_gunu BETWEEN 1 AND 2 THEN '1–2 Gün'
             WHEN t.tur_gunu BETWEEN 3 AND 5 THEN '3–5 Gün'
             WHEN t.tur_gunu >= 6 THEN '6+ Gün'
           END AS sure_grubu,
           COUNT(r.rezervasyon_id) AS rezervasyon_sayisi,
           COUNT(DISTINCT t.tur_id) AS tur_sayisi
         FROM turlar t
         LEFT JOIN rezervasyon r ON r.tur_id = t.tur_id
         WHERE t.tur_gunu IS NOT NULL
         GROUP BY sure_grubu
       ) a ON a.sure_grubu = g.sure_grubu
       ORDER BY FIELD(g.sure_grubu, '1–2 Gün', '3–5 Gün', '6+ Gün')`
    );

    res.json({
      groups: rows.map(r => ({
        sureGrubu: r.sure_grubu,
        rezervasyonSayisi: Number(r.rezervasyon_sayisi) || 0,
        turSayisi: Number(r.tur_sayisi) || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching tour duration insights:', error);
    res.status(500).json({
      error: 'Failed to fetch tour duration insights',
      message: error.message
    });
  }
});

// Tour Duration Analysis (reservation distribution by duration groups)
app.get('/api/tour-duration-analysis', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.sure_grubu,
              COALESCE(a.toplam_rezervasyon, 0) AS toplam_rezervasyon,
              COALESCE(a.hafta_ici, 0) AS hafta_ici,
              COALESCE(a.hafta_sonu, 0) AS hafta_sonu
       FROM (
         SELECT '1–2 Gün' AS sure_grubu
         UNION ALL SELECT '3–5 Gün'
         UNION ALL SELECT '6+ Gün'
       ) g
       LEFT JOIN (
         SELECT
           CASE
             WHEN t.tur_gunu BETWEEN 1 AND 2 THEN '1–2 Gün'
             WHEN t.tur_gunu BETWEEN 3 AND 5 THEN '3–5 Gün'
             WHEN t.tur_gunu >= 6 THEN '6+ Gün'
           END AS sure_grubu,
           COUNT(r.rezervasyon_id) AS toplam_rezervasyon,
           SUM(CASE WHEN DAYOFWEEK(r.rezervasyon_tarihi) BETWEEN 2 AND 6 THEN 1 ELSE 0 END) AS hafta_ici,
           SUM(CASE WHEN DAYOFWEEK(r.rezervasyon_tarihi) IN (1, 7) THEN 1 ELSE 0 END) AS hafta_sonu
         FROM rezervasyon r
         JOIN turlar t ON r.tur_id = t.tur_id
         WHERE t.tur_gunu IS NOT NULL
           AND r.rezervasyon_tarihi IS NOT NULL
         GROUP BY sure_grubu
       ) a ON a.sure_grubu = g.sure_grubu
       ORDER BY FIELD(g.sure_grubu, '1–2 Gün', '3–5 Gün', '6+ Gün')`
    );

    res.json(
      rows.map(r => ({
        label: r.sure_grubu,
        reservationCount: Number(r.toplam_rezervasyon) || 0,
        weekdayCount: Number(r.hafta_ici) || 0,
        weekendCount: Number(r.hafta_sonu) || 0
      }))
    );
  } catch (error) {
    console.error('Error fetching tour duration analysis:', error);
    res.status(500).json({
      error: 'Failed to fetch tour duration analysis',
      message: error.message
    });
  }
});

// Tour Trends by Type (last 3 months)
app.get('/api/tour-trends', async (req, res) => {
  try {
    // MySQL ONLY_FULL_GROUP_BY compatible query (as requested)
    const [rows] = await pool.query(
      `SELECT
        YEAR(r.rezervasyon_tarihi) AS yil,
        MONTH(r.rezervasyon_tarihi) AS ay,
        DATE_FORMAT(r.rezervasyon_tarihi, '%Y-%m') AS ay_label,
        t.tur_turu,
        COUNT(r.rezervasyon_id) AS rezervasyon_sayisi
      FROM rezervasyon r
      JOIN turlar t ON r.tur_id = t.tur_id
      WHERE r.rezervasyon_tarihi >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY
        YEAR(r.rezervasyon_tarihi),
        MONTH(r.rezervasyon_tarihi),
        DATE_FORMAT(r.rezervasyon_tarihi, '%Y-%m'),
        t.tur_turu
      ORDER BY yil, ay, t.tur_turu`
    );

    // Return JSON grouped by month
    const byMonth = new Map();
    for (const r of rows) {
      const key = r.ay_label;
      if (!byMonth.has(key)) {
        byMonth.set(key, {
          yil: Number(r.yil) || null,
          ay: Number(r.ay) || null,
          ay_label: r.ay_label,
          items: []
        });
      }
      byMonth.get(key).items.push({
        tur_turu: r.tur_turu,
        rezervasyon_sayisi: Number(r.rezervasyon_sayisi) || 0
      });
    }

    res.json(Array.from(byMonth.values()));
  } catch (error) {
    console.error('Error fetching tour trends:', error);
    res.status(500).json({
      error: 'Failed to fetch tour trends',
      message: error.message
    });
  }
});

// Campaign KPIs endpoint
app.get('/api/campaign/kpis', async (req, res) => {
  try {
    // 1. Calculate campaign reservation rate (%)
    const [totalReservations] = await pool.query(
      `SELECT COUNT(*) as total_count FROM rezervasyon`
    );
    const [campaignReservations] = await pool.query(
      `SELECT COUNT(*) as campaign_count FROM rezervasyon WHERE kampanya_id IS NOT NULL`
    );

    const totalCount = parseInt(totalReservations[0].total_count) || 0;
    const campaignCount = parseInt(campaignReservations[0].campaign_count) || 0;
    const campaignReservationRate = totalCount > 0
      ? ((campaignCount / totalCount) * 100).toFixed(1)
      : 0;

    // 2. Calculate total profit from campaign reservations
    const [campaignProfit] = await pool.query(
      `SELECT COALESCE(SUM(kar), 0) as total_profit 
       FROM rezervasyon 
       WHERE kampanya_id IS NOT NULL`
    );
    const campaignTotalProfit = parseFloat(campaignProfit[0].total_profit) || 0;

    // 3. Count distinct tours with campaign reservations but low occupancy (< 50)
    const [lowOccupancyTours] = await pool.query(
      `SELECT COUNT(DISTINCT r.tur_id) as tour_count
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.kampanya_id IS NOT NULL
         AND t.doluluk_orani < 50`
    );
    const lowOccupancyCampaignTourCount = parseInt(lowOccupancyTours[0].tour_count) || 0;

    res.json({
      campaignReservationRate: parseFloat(campaignReservationRate),
      campaignTotalProfit: campaignTotalProfit,
      lowOccupancyCampaignTourCount: lowOccupancyCampaignTourCount
    });
  } catch (error) {
    console.error('Error fetching campaign KPIs:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign KPIs',
      message: error.message
    });
  }
});

// Campaign Comparison endpoint
app.get('/api/kampanya-karsilastirma', async (req, res) => {
  try {
    const metric = req.query.metric || 'rezervasyon_sayisi';
    
    let kampanyaliQuery = '';
    let kampanyasizQuery = '';
    
    // Build queries based on selected metric
    switch (metric) {
      case 'rezervasyon_sayisi':
        kampanyaliQuery = `SELECT COUNT(r.rezervasyon_id) as value
                          FROM rezervasyon r
                          WHERE r.kampanya_id IS NOT NULL`;
        kampanyasizQuery = `SELECT COUNT(r.rezervasyon_id) as value
                           FROM rezervasyon r
                           WHERE r.kampanya_id IS NULL`;
        break;
        
      case 'ortalama_kar':
        kampanyaliQuery = `SELECT COALESCE(AVG(r.kar), 0) as value
                          FROM rezervasyon r
                          WHERE r.kampanya_id IS NOT NULL`;
        kampanyasizQuery = `SELECT COALESCE(AVG(r.kar), 0) as value
                           FROM rezervasyon r
                           WHERE r.kampanya_id IS NULL`;
        break;
        
      case 'toplam_kar':
        kampanyaliQuery = `SELECT COALESCE(SUM(r.kar), 0) as value
                          FROM rezervasyon r
                          WHERE r.kampanya_id IS NOT NULL`;
        kampanyasizQuery = `SELECT COALESCE(SUM(r.kar), 0) as value
                           FROM rezervasyon r
                           WHERE r.kampanya_id IS NULL`;
        break;
        
      case 'ortalama_doluluk_orani':
        kampanyaliQuery = `SELECT COALESCE(AVG(t.doluluk_orani), 0) as value
                          FROM rezervasyon r
                          JOIN turlar t ON r.tur_id = t.tur_id
                          WHERE r.kampanya_id IS NOT NULL`;
        kampanyasizQuery = `SELECT COALESCE(AVG(t.doluluk_orani), 0) as value
                           FROM rezervasyon r
                           JOIN turlar t ON r.tur_id = t.tur_id
                           WHERE r.kampanya_id IS NULL`;
        break;
        
      default:
        return res.status(400).json({
          error: 'Invalid metric',
          message: 'Metric must be one of: rezervasyon_sayisi, ortalama_kar, toplam_kar, ortalama_doluluk_orani'
        });
    }
    
    // Execute queries
    const [kampanyaliResult] = await pool.query(kampanyaliQuery);
    const [kampanyasizResult] = await pool.query(kampanyasizQuery);
    
    const kampanyali = parseFloat(kampanyaliResult[0].value) || 0;
    const kampanyasiz = parseFloat(kampanyasizResult[0].value) || 0;
    
    res.json({
      kampanyali: kampanyali,
      kampanyasiz: kampanyasiz
    });
  } catch (error) {
    console.error('Error fetching campaign comparison:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign comparison',
      message: error.message
    });
  }
});

// Campaign ROI Ranking endpoint
app.get('/api/campaign-roi-ranking', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        k.kampanya_id,
        k.kampanya_adi,
        COUNT(r.rezervasyon_id) AS rezervasyon_sayisi,
        COALESCE(SUM(r.kar), 0) AS toplam_kar,
        COALESCE(SUM(r.toplam_fiyat * k.indirim_yuzdesi / 100), 0) AS toplam_indirim_tutari,
        CASE 
          WHEN COALESCE(SUM(r.toplam_fiyat * k.indirim_yuzdesi / 100), 0) > 0 THEN
            ROUND(
              (COALESCE(SUM(r.kar), 0) / COALESCE(SUM(r.toplam_fiyat * k.indirim_yuzdesi / 100), 1)) * 100,
              2
            )
          ELSE 0
        END AS roi
      FROM rezervasyon r
      JOIN kampanya k ON r.kampanya_id = k.kampanya_id
      WHERE r.kampanya_id IS NOT NULL
      GROUP BY k.kampanya_id, k.kampanya_adi
      ORDER BY roi DESC`
    );

    const campaigns = rows.map(row => ({
      kampanyaId: row.kampanya_id,
      kampanyaAdi: row.kampanya_adi || 'İsimsiz Kampanya',
      rezervasyonSayisi: parseInt(row.rezervasyon_sayisi) || 0,
      toplamKar: parseFloat(row.toplam_kar) || 0,
      toplamIndirimTutari: parseFloat(row.toplam_indirim_tutari) || 0,
      roi: parseFloat(row.roi) || 0
    }));

    res.json({
      campaigns: campaigns
    });
  } catch (error) {
    console.error('Error fetching campaign ROI ranking:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign ROI ranking',
      message: error.message
    });
  }
});

// Campaign Occupancy Impact endpoint
app.get('/api/campaign-occupancy-impact', async (req, res) => {
  try {
    // Get tours with campaign reservations and calculate before/after occupancy
    // First get the earliest campaign start and latest campaign end for each tour
    const [rows] = await pool.query(
      `WITH tour_campaign_dates AS (
        SELECT 
          t.tur_id,
          t.tur_adi,
          COALESCE(t.kapasite, 1) AS kapasite,
          MIN(k.baslangic_tarihi) AS en_erken_baslangic,
          MAX(k.bitis_tarihi) AS en_gec_bitis
        FROM rezervasyon r
        JOIN turlar t ON r.tur_id = t.tur_id
        JOIN kampanya k ON r.kampanya_id = k.kampanya_id
        WHERE r.kampanya_id IS NOT NULL
        GROUP BY t.tur_id, t.tur_adi, t.kapasite
      )
      SELECT
        tcd.tur_id,
        tcd.tur_adi,
        tcd.kapasite,
        COALESCE(
          (SELECT COUNT(*) * 100.0 / tcd.kapasite
           FROM rezervasyon r_before
           WHERE r_before.tur_id = tcd.tur_id
             AND r_before.rezervasyon_tarihi < tcd.en_erken_baslangic),
          0
        ) AS oncesi_doluluk,
        COALESCE(
          (SELECT COUNT(*) * 100.0 / tcd.kapasite
           FROM rezervasyon r_after
           WHERE r_after.tur_id = tcd.tur_id
             AND r_after.rezervasyon_tarihi > tcd.en_gec_bitis),
          0
        ) AS sonrasi_doluluk
      FROM tour_campaign_dates tcd
      ORDER BY tcd.tur_adi`
    );

    const tours = rows.map(row => ({
      turId: row.tur_id,
      turAdi: row.tur_adi || 'İsimsiz Tur',
      oncesiDoluluk: Math.round(parseFloat(row.oncesi_doluluk) * 100) / 100,
      sonrasiDoluluk: Math.round(parseFloat(row.sonrasi_doluluk) * 100) / 100
    }));

    res.json({
      tours: tours
    });
  } catch (error) {
    console.error('Error fetching campaign occupancy impact:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign occupancy impact',
      message: error.message
    });
  }
});

// Campaign Occupancy Comparison Table endpoint
app.get('/api/campaign-occupancy-comparison-table', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        t.tur_id,
        t.tur_adi,
        k.kampanya_id,
        k.kampanya_adi,
        COALESCE(t.kapasite, 1) AS kapasite,
        k.baslangic_tarihi,
        k.bitis_tarihi,
        COALESCE(
          (SELECT COALESCE(SUM(r_before.kisi_sayisi), COUNT(r_before.rezervasyon_id)) * 100.0 / COALESCE(t.kapasite, 1)
           FROM rezervasyon r_before
           WHERE r_before.tur_id = t.tur_id
             AND r_before.rezervasyon_tarihi < k.baslangic_tarihi),
          0
        ) AS oncesi_doluluk,
        COALESCE(
          (SELECT COALESCE(SUM(r_after.kisi_sayisi), COUNT(r_after.rezervasyon_id)) * 100.0 / COALESCE(t.kapasite, 1)
           FROM rezervasyon r_after
           WHERE r_after.tur_id = t.tur_id
             AND r_after.rezervasyon_tarihi > k.bitis_tarihi),
          0
        ) AS sonrasi_doluluk
      FROM rezervasyon r
      JOIN turlar t ON r.tur_id = t.tur_id
      JOIN kampanya k ON r.kampanya_id = k.kampanya_id
      WHERE r.kampanya_id IS NOT NULL
      GROUP BY t.tur_id, t.tur_adi, k.kampanya_id, k.kampanya_adi, t.kapasite, k.baslangic_tarihi, k.bitis_tarihi
      ORDER BY t.tur_adi, k.kampanya_adi`
    );

    const comparisons = rows.map(row => {
      const oncesi = parseFloat(row.oncesi_doluluk) || 0;
      const sonrasi = parseFloat(row.sonrasi_doluluk) || 0;
      const degisim = sonrasi - oncesi;
      
      let etkiYorumu = '';
      if (degisim > 5) {
        etkiYorumu = 'Olumlu Etki';
      } else if (degisim >= -5 && degisim <= 5) {
        etkiYorumu = 'Nötr';
      } else {
        etkiYorumu = 'Olumsuz Etki';
      }

      return {
        turId: row.tur_id,
        turAdi: row.tur_adi || 'İsimsiz Tur',
        kampanyaId: row.kampanya_id,
        kampanyaAdi: row.kampanya_adi || 'İsimsiz Kampanya',
        oncesiDoluluk: Math.round(oncesi * 100) / 100,
        sonrasiDoluluk: Math.round(sonrasi * 100) / 100,
        degisim: Math.round(degisim * 100) / 100,
        etkiYorumu: etkiYorumu
      };
    });

    // Sort by degisim descending
    comparisons.sort((a, b) => b.degisim - a.degisim);

    res.json({
      comparisons: comparisons
    });
  } catch (error) {
    console.error('Error fetching campaign occupancy comparison table:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign occupancy comparison table',
      message: error.message
    });
  }
});

// Campaigns list endpoint (for dropdown options)
app.get('/api/campaigns', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT kampanya_id, kampanya_adi, indirim_yuzdesi
       FROM kampanya
       ORDER BY kampanya_adi ASC`
    );

    res.json({
      campaigns: rows.map(row => ({
        kampanyaId: row.kampanya_id,
        kampanyaAdi: row.kampanya_adi || 'İsimsiz Kampanya',
        indirimYuzdesi: parseFloat(row.indirim_yuzdesi) || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching campaigns list:', error);
    res.status(500).json({
      error: 'Failed to fetch campaigns list',
      message: error.message
    });
  }
});

// Campaign What-If Discount Simulation endpoint
app.get('/api/campaign-whatif-discount', async (req, res) => {
  try {
    const campaignId = req.query.campaign_id;
    const simulatedDiscount = parseFloat(req.query.simulated_discount);

    if (!campaignId || isNaN(simulatedDiscount) || simulatedDiscount < 0 || simulatedDiscount > 50) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'campaign_id and simulated_discount (0-50) are required'
      });
    }

    // Get campaign details including current discount rate
    const [campaignRows] = await pool.query(
      `SELECT kampanya_id, kampanya_adi, indirim_yuzdesi
       FROM kampanya
       WHERE kampanya_id = ?`,
      [campaignId]
    );

    if (!campaignRows || campaignRows.length === 0) {
      return res.status(404).json({
        error: 'Campaign not found'
      });
    }

    const campaign = campaignRows[0];
    const currentDiscount = parseFloat(campaign.indirim_yuzdesi) || 0;

    // Get all reservations for this campaign with tour details
    const [reservations] = await pool.query(
      `SELECT 
        r.rezervasyon_id,
        r.kisi_sayisi,
        t.fiyat,
        t.maliyet
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.kampanya_id = ?`,
      [campaignId]
    );

    // Calculate original and simulated profits
    let totalOriginalProfit = 0;
    let totalSimulatedProfit = 0;
    let reservationCount = reservations.length;

    reservations.forEach(reservation => {
      const kisiSayisi = parseFloat(reservation.kisi_sayisi) || 1;
      const fiyat = parseFloat(reservation.fiyat) || 0;
      const maliyet = parseFloat(reservation.maliyet) || 0;

      // Original calculation (with current discount)
      const originalPrice = fiyat * kisiSayisi;
      const originalPriceWithDiscount = originalPrice * (1 - currentDiscount / 100);
      const originalProfit = originalPriceWithDiscount - (maliyet * kisiSayisi);

      // Simulated calculation (with simulated discount)
      const simulatedPrice = originalPrice * (1 - simulatedDiscount / 100);
      const simulatedProfit = simulatedPrice - (maliyet * kisiSayisi);

      totalOriginalProfit += originalProfit;
      totalSimulatedProfit += simulatedProfit;
    });

    // Calculate average profits
    const avgOriginalProfit = reservationCount > 0 ? totalOriginalProfit / reservationCount : 0;
    const avgSimulatedProfit = reservationCount > 0 ? totalSimulatedProfit / reservationCount : 0;

    // Calculate profit difference percentage
    const profitDifference = totalOriginalProfit !== 0
      ? ((totalSimulatedProfit - totalOriginalProfit) / totalOriginalProfit) * 100
      : 0;

    res.json({
      campaign: {
        kampanyaId: campaign.kampanya_id,
        kampanyaAdi: campaign.kampanya_adi,
        mevcutIndirimOrani: currentDiscount
      },
      original: {
        toplamKar: totalOriginalProfit,
        ortalamaKar: avgOriginalProfit,
        rezervasyonSayisi: reservationCount
      },
      simulated: {
        indirimOrani: simulatedDiscount,
        toplamKar: totalSimulatedProfit,
        ortalamaKar: avgSimulatedProfit
      },
      comparison: {
        profitDifference: profitDifference
      }
    });
  } catch (error) {
    console.error('Error in campaign what-if discount simulation:', error);
    res.status(500).json({
      error: 'Failed to calculate simulation',
      message: error.message
    });
  }
});

// Campaign What-If Removal Simulation endpoint
app.get('/api/campaign-whatif-removal', async (req, res) => {
  try {
    const campaignId = req.query.campaign_id;

    if (!campaignId) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'campaign_id is required'
      });
    }

    // Get campaign details
    const [campaignRows] = await pool.query(
      `SELECT kampanya_id, kampanya_adi
       FROM kampanya
       WHERE kampanya_id = ?`,
      [campaignId]
    );

    if (!campaignRows || campaignRows.length === 0) {
      return res.status(404).json({
        error: 'Campaign not found'
      });
    }

    const campaign = campaignRows[0];

    // Get all reservations for this campaign with tour details
    const [reservations] = await pool.query(
      `SELECT 
        r.rezervasyon_id,
        r.kisi_sayisi,
        r.kar,
        t.fiyat,
        t.maliyet
       FROM rezervasyon r
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.kampanya_id = ?`,
      [campaignId]
    );

    // Calculate current and simulated profits
    let totalCurrentProfit = 0;
    let totalSimulatedProfit = 0;
    let reservationCount = reservations.length;

    reservations.forEach(reservation => {
      const kisiSayisi = parseFloat(reservation.kisi_sayisi) || 1;
      const fiyat = parseFloat(reservation.fiyat) || 0;
      const maliyet = parseFloat(reservation.maliyet) || 0;
      const currentKar = parseFloat(reservation.kar) || 0;

      // Current profit (with campaign discount)
      totalCurrentProfit += currentKar;

      // Simulated profit (without campaign - full price minus cost)
      const originalPrice = fiyat * kisiSayisi;
      const cost = maliyet * kisiSayisi;
      const simulatedProfit = originalPrice - cost;
      
      totalSimulatedProfit += simulatedProfit;
    });

    // Calculate average profits
    const avgCurrentProfit = reservationCount > 0 ? totalCurrentProfit / reservationCount : 0;
    const avgSimulatedProfit = reservationCount > 0 ? totalSimulatedProfit / reservationCount : 0;

    // Calculate profit difference percentage
    const profitDifference = totalCurrentProfit !== 0
      ? ((totalSimulatedProfit - totalCurrentProfit) / totalCurrentProfit) * 100
      : 0;

    res.json({
      campaign: {
        kampanyaId: campaign.kampanya_id,
        kampanyaAdi: campaign.kampanya_adi
      },
      current: {
        toplamKar: totalCurrentProfit,
        ortalamaKar: avgCurrentProfit,
        rezervasyonSayisi: reservationCount
      },
      simulated: {
        toplamKar: totalSimulatedProfit,
        ortalamaKar: avgSimulatedProfit
      },
      comparison: {
        profitDifference: profitDifference
      }
    });
  } catch (error) {
    console.error('Error in campaign what-if removal simulation:', error);
    res.status(500).json({
      error: 'Failed to calculate simulation',
      message: error.message
    });
  }
});

// Campaign Impact Matrix endpoint
app.get('/api/campaign-impact-matrix', async (req, res) => {
  try {
    const metric = req.query.metric || 'avg_profit';
    
    let metricQuery = '';
    let metricLabel = '';
    
    // Build SQL aggregation based on metric
    switch (metric) {
      case 'avg_profit':
        metricQuery = 'AVG(r.kar)';
        metricLabel = 'avgProfit';
        break;
      case 'total_profit':
        metricQuery = 'SUM(r.kar)';
        metricLabel = 'totalProfit';
        break;
      case 'reservation_count':
        metricQuery = 'COUNT(r.rezervasyon_id)';
        metricLabel = 'reservationCount';
        break;
      case 'avg_occupancy':
        metricQuery = 'AVG(t.doluluk_orani)';
        metricLabel = 'avgOccupancy';
        break;
      default:
        metricQuery = 'AVG(r.kar)';
        metricLabel = 'avgProfit';
    }
    
    // Get all campaigns
    const [campaigns] = await pool.query(
      `SELECT DISTINCT k.kampanya_id, k.kampanya_adi
       FROM kampanya k
       JOIN rezervasyon r ON k.kampanya_id = r.kampanya_id
       WHERE r.kampanya_id IS NOT NULL
       ORDER BY k.kampanya_adi ASC`
    );
    
    // Get all tour types
    const [tourTypes] = await pool.query(
      `SELECT DISTINCT t.tur_turu
       FROM turlar t
       JOIN rezervasyon r ON t.tur_id = r.tur_id
       WHERE r.kampanya_id IS NOT NULL
       ORDER BY t.tur_turu ASC`
    );
    
    // Get matrix data
    const [matrixData] = await pool.query(
      `SELECT 
        k.kampanya_adi,
        t.tur_turu,
        COALESCE(${metricQuery}, 0) AS metric_value
       FROM rezervasyon r
       JOIN kampanya k ON r.kampanya_id = k.kampanya_id
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE r.kampanya_id IS NOT NULL
       GROUP BY k.kampanya_adi, t.tur_turu
       ORDER BY k.kampanya_adi ASC, t.tur_turu ASC`
    );
    
    // Build matrix structure
    const matrix = {};
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    matrixData.forEach(row => {
      const kampanyaAdi = row.kampanya_adi || 'İsimsiz Kampanya';
      const turTuru = row.tur_turu || 'İsimsiz Tur';
      const value = parseFloat(row.metric_value) || 0;
      
      if (!matrix[kampanyaAdi]) {
        matrix[kampanyaAdi] = {};
      }
      
      matrix[kampanyaAdi][turTuru] = value;
      
      // Track min/max for color coding
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    });
    
    // Find best combination
    let bestCampaign = '';
    let bestTourType = '';
    let bestValue = -Infinity;
    
    Object.keys(matrix).forEach(kampanyaAdi => {
      Object.keys(matrix[kampanyaAdi]).forEach(turTuru => {
        const value = matrix[kampanyaAdi][turTuru];
        if (value > bestValue) {
          bestValue = value;
          bestCampaign = kampanyaAdi;
          bestTourType = turTuru;
        }
      });
    });
    
    res.json({
      campaigns: campaigns.map(c => c.kampanya_adi || 'İsimsiz Kampanya'),
      tourTypes: tourTypes.map(t => t.tur_turu || 'İsimsiz Tur'),
      matrix: matrix,
      valueRange: {
        min: minValue === Infinity ? 0 : minValue,
        max: maxValue === -Infinity ? 0 : maxValue
      },
      bestCombination: {
        campaign: bestCampaign,
        tourType: bestTourType,
        value: bestValue === -Infinity ? 0 : bestValue
      },
      metric: metricLabel
    });
  } catch (error) {
    console.error('Error fetching campaign impact matrix:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign impact matrix',
      message: error.message
    });
  }
});

// Age Distribution endpoint (Anket Analizi)
app.get('/api/anket/age-distribution', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        CASE
          WHEN yas BETWEEN 18 AND 24 THEN '18-24'
          WHEN yas BETWEEN 25 AND 34 THEN '25-34'
          WHEN yas BETWEEN 35 AND 44 THEN '35-44'
          WHEN yas BETWEEN 45 AND 54 THEN '45-54'
          WHEN yas >= 55 THEN '55+'
        END AS yas_grubu,
        COUNT(*) AS sayi
       FROM musteriler
       WHERE yas IS NOT NULL AND yas > 0
       GROUP BY yas_grubu
       ORDER BY FIELD(yas_grubu, '18-24', '25-34', '35-44', '45-54', '55+')`
    );

    // Initialize all age groups with 0 (only valid age groups, no 'Bilinmiyor')
    const ageGroups = ['18-24', '25-34', '35-44', '45-54', '55+'];
    const counts = new Array(ageGroups.length).fill(0);

    // Map results to arrays
    rows.forEach(row => {
      const index = ageGroups.indexOf(row.yas_grubu);
      if (index !== -1) {
        counts[index] = parseInt(row.sayi) || 0;
      }
    });

    // Calculate total
    const total = counts.reduce((sum, count) => sum + count, 0);

    res.json({
      labels: ageGroups,
      counts: counts,
      total: total
    });
  } catch (error) {
    console.error('Error fetching age distribution:', error);
    res.status(500).json({
      error: 'Failed to fetch age distribution',
      message: error.message
    });
  }
});

// Age Group × Tour Type Heatmap endpoint (Anket Analizi)
app.get('/api/analytics/age-tour-heatmap', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        CASE
          WHEN m.yas BETWEEN 18 AND 24 THEN '18-24'
          WHEN m.yas BETWEEN 25 AND 34 THEN '25-34'
          WHEN m.yas BETWEEN 35 AND 44 THEN '35-44'
          WHEN m.yas BETWEEN 45 AND 54 THEN '45-54'
          WHEN m.yas >= 55 THEN '55+'
          ELSE NULL
        END AS yas_grubu,
        t.tur_turu AS tur_turu,
        COUNT(*) AS rezervasyon_sayisi
       FROM rezervasyon r
       JOIN musteriler m ON r.musteri_id = m.musteri_id
       JOIN turlar t ON r.tur_id = t.tur_id
       WHERE m.yas IS NOT NULL
       GROUP BY yas_grubu, t.tur_turu
       HAVING yas_grubu IS NOT NULL
       ORDER BY 
         FIELD(yas_grubu, '18-24', '25-34', '35-44', '45-54', '55+'),
         t.tur_turu`
    );

    // Fixed age groups in order
    const ageGroups = ['18-24', '25-34', '35-44', '45-54', '55+'];
    
    // Collect unique tour types and sort alphabetically
    const tourTypesSet = new Set();
    rows.forEach(row => {
      if (row.tur_turu) {
        tourTypesSet.add(row.tur_turu);
      }
    });
    const tourTypes = Array.from(tourTypesSet).sort();

    // Initialize matrix with zeros
    const matrix = ageGroups.map(() => new Array(tourTypes.length).fill(0));

    // Fill matrix with actual data
    let maxValue = 0;
    let topCell = { ageGroup: '', tourType: '', value: 0 };

    rows.forEach(row => {
      const ageIndex = ageGroups.indexOf(row.yas_grubu);
      const tourIndex = tourTypes.indexOf(row.tur_turu);
      
      if (ageIndex !== -1 && tourIndex !== -1) {
        const count = parseInt(row.rezervasyon_sayisi) || 0;
        matrix[ageIndex][tourIndex] = count;
        
        // Track max value and top cell
        if (count > maxValue) {
          maxValue = count;
          topCell = {
            ageGroup: row.yas_grubu,
            tourType: row.tur_turu,
            value: count
          };
        }
      }
    });

    res.json({
      ageGroups: ageGroups,
      tourTypes: tourTypes,
      matrix: matrix,
      maxValue: maxValue,
      topCell: topCell
    });
  } catch (error) {
    console.error('Error fetching age-tour heatmap:', error);
    res.status(500).json({
      error: 'Failed to fetch age-tour heatmap',
      message: error.message
    });
  }
});

// Age Group × Campaign Sensitivity endpoint (Anket Analizi)
app.get('/api/analytics/age-campaign-sensitivity', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        CASE
          WHEN m.yas BETWEEN 18 AND 24 THEN '18-24'
          WHEN m.yas BETWEEN 25 AND 34 THEN '25-34'
          WHEN m.yas BETWEEN 35 AND 44 THEN '35-44'
          WHEN m.yas BETWEEN 45 AND 54 THEN '45-54'
          WHEN m.yas >= 55 THEN '55+'
          ELSE NULL
        END AS yas_grubu,
        CASE
          WHEN r.kampanya_id IS NULL THEN 'Kampanyasız'
          ELSE 'Kampanyalı'
        END AS kampanya_durumu,
        COUNT(*) AS rezervasyon_sayisi
       FROM rezervasyon r
       JOIN musteriler m ON m.musteri_id = r.musteri_id
       WHERE m.yas IS NOT NULL AND m.yas > 0
       GROUP BY yas_grubu, kampanya_durumu
       HAVING yas_grubu IS NOT NULL
       ORDER BY FIELD(yas_grubu, '18-24', '25-34', '35-44', '45-54', '55+'), kampanya_durumu`
    );

    // Fixed age groups in order
    const ageGroups = ['18-24', '25-34', '35-44', '45-54', '55+'];
    
    // Initialize arrays for counts
    const kampanyaliCounts = new Array(ageGroups.length).fill(0);
    const kampanyasizCounts = new Array(ageGroups.length).fill(0);

    // Fill counts from query results
    rows.forEach(row => {
      const ageIndex = ageGroups.indexOf(row.yas_grubu);
      if (ageIndex !== -1) {
        const count = parseInt(row.rezervasyon_sayisi) || 0;
        if (row.kampanya_durumu === 'Kampanyalı') {
          kampanyaliCounts[ageIndex] = count;
        } else if (row.kampanya_durumu === 'Kampanyasız') {
          kampanyasizCounts[ageIndex] = count;
        }
      }
    });

    // Calculate percentages
    const kampanyaliPercentages = [];
    const kampanyasizPercentages = [];
    let topSensitive = { ageGroup: '', kampanyaliPct: 0 };

    ageGroups.forEach((ageGroup, index) => {
      const total = kampanyaliCounts[index] + kampanyasizCounts[index];
      const kampanyaliPct = total > 0 ? (kampanyaliCounts[index] / total) * 100 : 0;
      const kampanyasizPct = total > 0 ? (kampanyasizCounts[index] / total) * 100 : 0;

      kampanyaliPercentages.push(parseFloat(kampanyaliPct.toFixed(2)));
      kampanyasizPercentages.push(parseFloat(kampanyasizPct.toFixed(2)));

      // Track top sensitive age group
      if (kampanyaliPct > topSensitive.kampanyaliPct) {
        topSensitive = {
          ageGroup: ageGroup,
          kampanyaliPct: parseFloat(kampanyaliPct.toFixed(2))
        };
      }
    });

    res.json({
      ageGroups: ageGroups,
      counts: {
        'Kampanyalı': kampanyaliCounts,
        'Kampanyasız': kampanyasizCounts
      },
      percentages: {
        'Kampanyalı': kampanyaliPercentages,
        'Kampanyasız': kampanyasizPercentages
      },
      topSensitive: topSensitive
    });
  } catch (error) {
    console.error('Error fetching age-campaign sensitivity:', error);
    res.status(500).json({
      error: 'Failed to fetch age-campaign sensitivity',
      message: error.message
    });
  }
});

// Top Priority Features endpoint (Anket Analizi)
app.get('/api/anket/top-oncelikli-ozellikler', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        TRIM(oncelikli_ozellikler) AS ozellik,
        COUNT(*) AS adet
       FROM anket_yanitlari
       WHERE oncelikli_ozellikler IS NOT NULL
         AND TRIM(oncelikli_ozellikler) <> ''
       GROUP BY TRIM(oncelikli_ozellikler)
       ORDER BY adet DESC
       LIMIT 10`
    );

    const labels = rows.map(row => row.ozellik || 'İsimsiz');
    const counts = rows.map(row => parseInt(row.adet) || 0);

    res.json({
      labels: labels,
      counts: counts
    });
  } catch (error) {
    console.error('Error fetching top priority features:', error);
    res.status(500).json({
      error: 'Failed to fetch top priority features',
      message: error.message
    });
  }
});

// Activity Preferences endpoint (Anket Analizi)
app.get('/api/anket/aktivite-tercihleri', async (req, res) => {
  try {
    // Try to query gormek_istedigi_aktivite column first
    const [rows] = await pool.query(
      `SELECT
        TRIM(gormek_istedigi_aktivite) AS aktivite,
        COUNT(*) AS adet
       FROM anket_yanitlari
       WHERE gormek_istedigi_aktivite IS NOT NULL
         AND TRIM(gormek_istedigi_aktivite) <> ''
       GROUP BY TRIM(gormek_istedigi_aktivite)
       ORDER BY adet DESC
       LIMIT 8`
    );

    if (!rows || rows.length === 0) {
      // Return empty dataset if no data found
      return res.json({
        labels: [],
        counts: [],
        topActivity: null
      });
    }

    const labels = rows.map(row => row.aktivite || 'İsimsiz');
    const counts = rows.map(row => parseInt(row.adet) || 0);

    // Find top activity
    const maxIndex = counts.indexOf(Math.max(...counts));
    const topActivity = {
      name: labels[maxIndex],
      count: counts[maxIndex]
    };

    res.json({
      labels: labels,
      counts: counts,
      topActivity: topActivity
    });
  } catch (error) {
    // If column doesn't exist, return empty dataset gracefully
    console.error('Error fetching activity preferences:', error);
    if (error.code === 'ER_BAD_FIELD_ERROR' || error.message.includes('Unknown column')) {
      return res.json({
        labels: [],
        counts: [],
        topActivity: null
      });
    }
    res.status(500).json({
      error: 'Failed to fetch activity preferences',
      message: error.message
    });
  }
});

// Campaign Impact Score Distribution endpoint (Anket Analizi)
app.get('/api/anket/kampanya-etkisi-dagilimi', async (req, res) => {
  try {
    // Query to get campaign impact scores
    // Try to get numeric values from kampanya_etkisi column
    let query = `
      SELECT 
        kampanya_etkisi AS cevap
      FROM anket_yanitlari
      WHERE kampanya_etkisi IS NOT NULL
        AND TRIM(kampanya_etkisi) <> ''
    `;

    const [rows] = await pool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        segments: [
          { segment: 'Düşük Etki (0–1)', count: 0 },
          { segment: 'Orta Etki (2–3)', count: 0 },
          { segment: 'Yüksek Etki (4–5)', count: 0 }
        ],
        total: 0,
        avgScore: 0
      });
    }

    // Function to convert answer to numeric score (0-5)
    function mapAnswerToScore(answer) {
      if (!answer) return null;
      
      const normalized = answer.toString().trim();
      
      // Check if already numeric
      const numeric = parseInt(normalized);
      if (!isNaN(numeric) && numeric >= 0 && numeric <= 5) {
        return numeric;
      }
      
      // Map Turkish text responses to numeric (0-5)
      const lower = normalized.toLowerCase();
      if (lower.includes('hiç') || lower.includes('etkilemedi') || lower.includes('yok') || lower.includes('0')) {
        return 0;
      }
      if (lower.includes('az') && lower.includes('etkiledi')) {
        return 1;
      }
      if (lower === '1' || (lower.includes('çok') === false && lower.includes('az') === false && lower.includes('orta') === false && lower.includes('etkiledi'))) {
        return 1;
      }
      if (lower.includes('orta') || lower.includes('kararsız') || lower === '2' || lower === '3') {
        return parseInt(normalized) || 3;
      }
      if (lower.includes('etkiledi') && !lower.includes('çok') && !lower.includes('az')) {
        return 4;
      }
      if (lower.includes('çok') || lower.includes('kesinlikle') || lower.includes('çok etkiledi') || lower === '4' || lower === '5') {
        return parseInt(normalized) || 5;
      }
      
      return null;
    }

    // Initialize segment counts
    const segmentCounts = {
      'Düşük Etki (0–1)': 0,
      'Orta Etki (2–3)': 0,
      'Yüksek Etki (4–5)': 0
    };

    let totalScore = 0;
    let validScores = 0;

    // Process each row and segment scores
    rows.forEach(row => {
      const score = mapAnswerToScore(row.cevap);
      if (score !== null && score >= 0 && score <= 5) {
        if (score >= 0 && score <= 1) {
          segmentCounts['Düşük Etki (0–1)']++;
        } else if (score >= 2 && score <= 3) {
          segmentCounts['Orta Etki (2–3)']++;
        } else if (score >= 4 && score <= 5) {
          segmentCounts['Yüksek Etki (4–5)']++;
        }
        totalScore += score;
        validScores++;
      }
    });

    const total = validScores;
    const avgScore = validScores > 0 ? totalScore / validScores : 0;

    const segments = [
      { segment: 'Düşük Etki (0–1)', count: segmentCounts['Düşük Etki (0–1)'] },
      { segment: 'Orta Etki (2–3)', count: segmentCounts['Orta Etki (2–3)'] },
      { segment: 'Yüksek Etki (4–5)', count: segmentCounts['Yüksek Etki (4–5)'] }
    ];

    res.json({
      segments: segments,
      total: total,
      avgScore: parseFloat(avgScore.toFixed(1))
    });
  } catch (error) {
    console.error('Error fetching campaign impact distribution:', error);
    // If column doesn't exist or query fails, return empty dataset gracefully
    if (error.code === 'ER_BAD_FIELD_ERROR' || error.message.includes('Unknown column')) {
      return res.json({
        segments: [
          { segment: 'Düşük Etki (0–1)', count: 0 },
          { segment: 'Orta Etki (2–3)', count: 0 },
          { segment: 'Yüksek Etki (4–5)', count: 0 }
        ],
        total: 0,
        avgScore: 0
      });
    }
    res.status(500).json({
      error: 'Failed to fetch campaign impact distribution',
      message: error.message
    });
  }
});

// Vacation Frequency Distribution endpoint (Anket Analizi)
app.get('/api/anket/tatil-sikligi-dagilimi', async (req, res) => {
  try {
    // Query to get vacation frequency answers
    // Try tatil_sikligi column (following the pattern of other question columns)
    const [rows] = await pool.query(
      `SELECT 
        tatil_sikligi AS cevap
       FROM anket_yanitlari
       WHERE tatil_sikligi IS NOT NULL
         AND TRIM(tatil_sikligi) <> ''`
    );

    if (!rows || rows.length === 0) {
      return res.json({
        labels: ['1', '2', '3', '4+'],
        counts: [0, 0, 0, 0],
        topLabel: null,
        topCount: 0
      });
    }

    // Function to convert answer to numeric value (1-4+)
    function mapAnswerToValue(answer) {
      if (!answer) return null;
      
      const normalized = answer.toString().trim();
      
      // Check if already numeric
      const numeric = parseInt(normalized);
      if (!isNaN(numeric) && numeric >= 1) {
        return numeric >= 4 ? 4 : numeric; // Treat 4+ as 4
      }
      
      // Handle text variations like "4+", "4 ve üzeri", etc.
      const lower = normalized.toLowerCase();
      if (lower.includes('4') && (lower.includes('+') || lower.includes('üzeri') || lower.includes('fazla'))) {
        return 4;
      }
      if (normalized === '1' || lower.includes('bir')) {
        return 1;
      }
      if (normalized === '2' || lower.includes('iki')) {
        return 2;
      }
      if (normalized === '3' || lower.includes('üç')) {
        return 3;
      }
      
      return null;
    }

    // Initialize counts for each segment
    const segmentCounts = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4+': 0
    };

    // Process each row and count by segment
    rows.forEach(row => {
      const value = mapAnswerToValue(row.cevap);
      if (value !== null && value >= 1) {
        if (value === 1) {
          segmentCounts['1']++;
        } else if (value === 2) {
          segmentCounts['2']++;
        } else if (value === 3) {
          segmentCounts['3']++;
        } else if (value >= 4) {
          segmentCounts['4+']++;
        }
      }
    });

    const labels = ['1', '2', '3', '4+'];
    const counts = [
      segmentCounts['1'],
      segmentCounts['2'],
      segmentCounts['3'],
      segmentCounts['4+']
    ];

    // Find top segment
    const maxCount = Math.max(...counts);
    const maxIndex = counts.indexOf(maxCount);
    const topLabel = maxCount > 0 ? labels[maxIndex] : null;
    const topCount = maxCount;

    res.json({
      labels: labels,
      counts: counts,
      topLabel: topLabel,
      topCount: topCount
    });
  } catch (error) {
    // If column doesn't exist, return empty dataset gracefully
    console.error('Error fetching vacation frequency distribution:', error);
    if (error.code === 'ER_BAD_FIELD_ERROR' || error.message.includes('Unknown column')) {
      return res.json({
        labels: ['1', '2', '3', '4+'],
        counts: [0, 0, 0, 0],
        topLabel: null,
        topCount: 0
      });
    }
    res.status(500).json({
      error: 'Failed to fetch vacation frequency distribution',
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
