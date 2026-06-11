const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_chronotask_key_123!';

const emailRegex = /\S+@\S+\.\S+/;