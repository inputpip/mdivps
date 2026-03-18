const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3001;

// Allow all origins for subdomains compatibility
app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure default directories exist for backwards compatibility
['deliveries', 'customers', 'general'].forEach(cat => {
    const dir = path.join(uploadsDir, cat);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure storage with dynamic 3-layer path
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Fallback untuk backward compatibility jika params tidak lengkap
        const category = req.body.category || 'general';
        const database = req.body.database || '';
        const branch = req.body.branch || '';
        
        // Membangun URL hierarki.
        // Jika parameter lengkap dikirim dari FE baru, jadinya: uploads/mkw_db/Manokwari/customers/
        // Jika file lawas tanpa param, baliknya ke: uploads/customers/
        
        let targetPath = uploadsDir;
        if (database) targetPath = path.join(targetPath, database);
        if (branch) targetPath = path.join(targetPath, branch);
        targetPath = path.join(targetPath, category);
        
        // Buat semua parent directory otomatis
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
        
        cb(null, targetPath);
    },
    filename: function (req, file, cb) {
        const filename = req.body.filename || `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only images and PDFs are allowed'));
        }
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Static file serving untuk membaca file lama DAN file baru
app.use("/files", express.static(uploadsDir));

app.post("/upload", (req, res) => {
    // Handling array of single file inside multer
    const uploadSingle = upload.single("file");
    
    uploadSingle(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error("Multer error:", err);
            return res.status(400).json({ error: err.message });
        } else if (err) {
            console.error("Upload error:", err);
            return res.status(500).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const category = req.body.category || 'general';
        const database = req.body.database || '';
        const branch = req.body.branch || '';
        const filename = req.file.filename;
        
        // Buat fileUrl menyesuaikan struktur layer baru
        let fileUrlPath = '';
        if (database) fileUrlPath += `${database}/`;
        if (branch) fileUrlPath += `${branch}/`;
        fileUrlPath += `${category}/${filename}`;
        
        const fileUrl = `https://upload.aquvit.id/files/${fileUrlPath}`;

        res.json({
            success: true,
            file: {
                category,
                database: database || null,
                branch: branch || null,
                filename,
                originalName: req.file.originalname,
                size: req.file.size,
                fileUrl
            }
        });
    });
});

// Delete Endpoint untuk tipe File Baru (3 Lapis Parameter: /files/mkw_db/Manokwari/cat/file.jpg)
app.delete("/files/:database/:branch/:category/:filename", (req, res) => {
    const filePath = path.join(uploadsDir, req.params.database, req.params.branch, req.params.category, req.params.filename);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            res.json({ success: true, message: "File deleted" });
        } catch (e) {
            res.status(500).json({ error: "Failed to delete file" });
        }
    } else {
        res.status(404).json({ error: "File not found" });
    }
});

// Delete Endpoint untuk File Lama (Backward Compatibility)
app.delete("/files/:category/:filename", (req, res) => {
    const filePath = path.join(uploadsDir, req.params.category, req.params.filename);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            res.json({ success: true, message: "File deleted" });
        } catch (e) {
            res.status(500).json({ error: "Failed to delete file" });
        }
    } else {
        res.status(404).json({ error: "File not found" });
    }
});

app.listen(PORT, () => {
    console.log("Upload server running on port " + PORT + " with 3-Layer Routing Strategy");
});
