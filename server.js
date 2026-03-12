const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'qq',
  auth: {
    user: '1246989571@qq.com',
    pass: 'qkrjfrbbwttjgheh'
  }
});

app.post('/send', async (req, res) => {
  const { to, subject, text, html } = req.body;
  
  const mailOptions = {
    from: '1246989571@qq.com',
    to,
    subject,
  };
  
  // 如果有html，优先使用html，否则用text
  if (html) {
    mailOptions.html = html;
  } else if (text) {
    mailOptions.text = text;
  }
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    res.json({ success: true, message: '邮件发送成功', id: info.messageId });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Email service running on port ' + PORT);
});
