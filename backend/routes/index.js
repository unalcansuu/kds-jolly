const express = require('express');
const router = express.Router();

const dashboardController = require('../controllers/dashboardController');

// örnek route – controller'a yönlendiriyor
router.get('/tour-types', dashboardController.getTourTypeStats);

module.exports = router;
