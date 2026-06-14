const express = require('express');
const app = express();
const path = require('path');

require('dotenv').config();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'video-editor.html'));
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`GPU Video Editor running on http://localhost:${PORT}`));
}

module.exports = { app };