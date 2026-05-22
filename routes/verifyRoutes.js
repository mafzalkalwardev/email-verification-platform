const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifySingleEmail, uploadBulkFile } = require('../controllers/verifyController');
const { protect } = require('../middlewares/authMiddleware');

const upload = multer({ dest: 'uploads/' });

router.post('/single', protect, verifySingleEmail);
router.post('/upload-bulk', protect, upload.single('file'), uploadBulkFile);

module.exports = router;
