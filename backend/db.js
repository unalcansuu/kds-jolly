console.log('🔥 THIS db.js FILE IS LOADED');
const mysql = require('mysql2');

// Create MySQL connection pool
const pool = mysql.createPool({
  host: 'localhost',
  port: 8889,
  user: 'root',
  password: 'root',
  database: 'Jolly SmarTour KDS',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Get a promise-based connection
const promisePool = pool.promise();

// Test database connection
async function testConnection() {
  try {
    const connection = await promisePool.getConnection();
    console.log('✅ Database connection successful!');
    console.log(`📊 Connected to database: Jolly SmarTour KDS`);
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

module.exports = {
  pool: promisePool,
  testConnection
};

