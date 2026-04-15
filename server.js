require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const app = express();

const user = process.env.AUTH_USER || 'admin';
const pass = process.env.AUTH_PASS || 'password123';

app.use(basicAuth({ users: { [user]: pass }, challenge: true }));
app.use(express.static(path.join(__dirname, '.')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Lock active on port ${port}`));