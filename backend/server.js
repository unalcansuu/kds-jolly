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
