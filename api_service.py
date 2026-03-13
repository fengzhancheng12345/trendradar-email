#!/usr/bin/env python3
"""
TrendRadar API Service - User, Stock & Payment Management
Connects website (port 80) with email service (port 3000)
"""

import sqlite3
import uuid
import hashlib
import json
import requests
from flask import Flask, request, jsonify, g
from functools import wraps
from datetime import datetime

app = Flask(__name__)
DATABASE = '/root/trendradar.db'

# 会员等级配置
TIER_CONFIG = {
    'free': {'credits': 3, 'price': 0},
    'basic': {'credits': 10, 'price': 9.9},
    'pro': {'credits': 50, 'price': 39.9},
    'vip': {'credits': 999999, 'price': 99.9}
}

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database tables"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        tier TEXT DEFAULT 'free',
        credits INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # Stocks table
    c.execute('''CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        market TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')
    
    # Orders table (购买记录)
    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tier TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USDT',
        txid TEXT,
        status TEXT DEFAULT 'pending',
        payment_method TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')
    
    conn.commit()
    conn.close()
    conn.commit()
    conn.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'detail': 'Missing token'}), 401
        
        # Simple token validation (username:uuid)
        try:
            username, token_val = token.split(':')
            db = get_db()
            user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
            if not user:
                return jsonify({'detail': 'Invalid token'}), 401
            g.user = user
        except:
            return jsonify({'detail': 'Invalid token format'}), 401
        
        return f(*args, **kwargs)
    return decorated

# === Auth Endpoints ===

@app.route('/api/v1/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    email = data.get('email', '')
    
    if not username or not password:
        return jsonify({'detail': 'Missing username or password'}), 400
    
    # Hash password
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    
    try:
        db = get_db()
        db.execute('INSERT INTO users (username, password, email, credits) VALUES (?, ?, ?, 3)',
                   (username, password_hash, email))
        db.commit()
        return jsonify({'message': 'User created', 'credits': 3})
    except sqlite3.IntegrityError:
        return jsonify({'detail': 'Username already exists'}), 400

@app.route('/api/v1/auth/login', methods=['POST'])
def login():
    data = request.form or request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'detail': 'Missing credentials'}), 400
    
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username = ? AND password = ?',
                      (username, password_hash)).fetchone()
    
    if not user:
        return jsonify({'detail': 'Invalid credentials'}), 401
    
    # Generate simple token
    token = f"{username}:{uuid.uuid4().hex[:8]}"
    
    return jsonify({
        'access_token': token,
        'username': username,
        'tier': user['tier'],
        'credits': user['credits']
    })

# === Stock Endpoints ===

@app.route('/api/v1/stocks/', methods=['GET'])
@token_required
def list_stocks():
    db = get_db()
    stocks = db.execute('SELECT * FROM stocks WHERE user_id = ? ORDER BY created_at DESC',
                       (g.user['id'],)).fetchall()
    return jsonify([dict(row) for row in stocks])

@app.route('/api/v1/stocks/', methods=['POST'])
@token_required
def add_stock():
    data = request.json
    db = get_db()
    db.execute('INSERT INTO stocks (user_id, stock_code, stock_name, market) VALUES (?, ?, ?, ?)',
               (g.user['id'], data['stock_code'], data['stock_name'], data.get('market', '')))
    db.commit()
    return jsonify({'message': 'Stock added'})

@app.route('/api/v1/stocks/<int:stock_id>', methods=['DELETE'])
@token_required
def delete_stock(stock_id):
    db = get_db()
    db.execute('DELETE FROM stocks WHERE id = ? AND user_id = ?', (stock_id, g.user['id']))
    db.commit()
    return jsonify({'message': 'Stock deleted'})

@app.route('/api/v1/stocks/search/<query>', methods=['GET'])
def search_stocks():
    """Search stocks via Tencent API"""
    query = request.path.split('/')[-1]
    url = f'https://searchapi.eastmoney.com/api/suggest/get?input={query}&type=14&count=10'
    try:
        resp = requests.get(url, timeout=5, headers={'User-Agent': 'Mozilla/5.0'})
        data = resp.json()
        results = []
        for item in data.get('QuotationCodeTable', {}).get('Data', [])[:10]:
            results.append({
                'stock_code': item.get('Code', ''),
                'stock_name': item.get('Name', ''),
                'market': 'SH' if item.get('Market', '') == '1' else 'SZ'
            })
        return jsonify(results)
    except Exception as e:
        return jsonify([])

@app.route('/api/v1/stocks/hot', methods=['GET'])
def get_hot_stocks():
    """Get hot stocks list"""
    hot_codes = ['sh000001', 'sz399001', 'sh000300', 'sz399006', 'sh000688',
                 '600519', '000858', '601318', '600036', '000001']
    return jsonify([{'stock_code': c, 'stock_name': c} for c in hot_codes])

# === Email Endpoint ===

@app.route('/api/v1/email/send', methods=['POST'])
@token_required
def send_email():
    """Send analysis report to user's email"""
    user = g.user
    
    # Check credits
    if user['credits'] <= 0:
        return jsonify({'detail': 'No credits left'}), 403
    
    # Get user's stocks
    db = get_db()
    stocks = db.execute('SELECT stock_code, stock_name FROM stocks WHERE user_id = ?',
                       (user['id'],)).fetchall()
    
    # Prepare stock codes for email service
    stock_codes = [s['stock_code'] for s in stocks] if stocks else ['600519', '000858']
    
    # Call email service on port 3000
    try:
        # Get user email or use default
        user_email = user['email'] or '1246989571@qq.com'
        
        # Call the email service
        email_resp = requests.post(
            'http://127.0.0.1:3000/send',
            json={
                'to': user_email,
                'subject': f'📊 TrendRadar {user["username"]} 的股票分析报告',
                'stocks': stock_codes
            },
            timeout=60
        )
        
        if email_resp.status_code == 200:
            # Deduct credit
            db.execute('UPDATE users SET credits = credits - 1 WHERE id = ?', (user['id'],))
            db.commit()
            
            remaining = user['credits'] - 1
            return jsonify({
                'message': 'Email sent successfully',
                'credits_remaining': remaining
            })
        else:
            return jsonify({'detail': 'Email service error'}), 500
            
    except requests.exceptions.RequestException as e:
        return jsonify({'detail': f'Cannot connect to email service: {str(e)}'}), 503

# === Orders & Payment Endpoints ===

@app.route('/api/v1/orders', methods=['GET'])
@token_required
def list_orders():
    """获取用户订单列表"""
    db = get_db()
    orders = db.execute('''SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC''',
                       (g.user['id'],)).fetchall()
    return jsonify([dict(o) for o in orders])

@app.route('/api/v1/orders', methods=['POST'])
@token_required
def create_order():
    """创建订单"""
    data = request.json
    tier = data.get('tier', 'basic')
    currency = data.get('currency', 'USDT')
    payment_method = data.get('payment_method', 'crypto')
    
    if tier not in TIER_CONFIG:
        return jsonify({'detail': 'Invalid tier'}), 400
    
    price = TIER_CONFIG[tier]['price']
    
    db = get_db()
    order_id = str(uuid.uuid4())[:8]
    
    db.execute('''INSERT INTO orders (user_id, tier, amount, currency, txid, status, payment_method)
                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
               (g.user['id'], tier, price, currency, '', 'pending', payment_method))
    db.commit()
    
    order = db.execute('SELECT * FROM orders WHERE id = ?', (db.execute('SELECT last_insert_rowid()').fetchone()[0],)).fetchone()
    
    return jsonify({
        'order_id': order['id'],
        'tier': tier,
        'amount': price,
        'currency': currency,
        'status': 'pending',
        'wallet_address': '0x78505a332208C5d5de6332A41c89fb306F1BaB95',  # 充值地址
        'instructions': f'请向以上地址转账 {price} {currency}，然后提交TXID验证'
    })

@app.route('/api/v1/orders/verify', methods=['POST'])
@token_required
def verify_payment():
    """验证支付 (TXID验证)"""
    data = request.json
    order_id = data.get('order_id')
    txid = data.get('txid', '')
    
    if not txid:
        return jsonify({'detail': 'Missing TXID'}), 400
    
    db = get_db()
    order = db.execute('SELECT * FROM orders WHERE id = ? AND user_id = ?',
                      (order_id, g.user['id'])).fetchone()
    
    if not order:
        return jsonify({'detail': 'Order not found'}), 404
    
    if order['status'] == 'paid':
        return jsonify({'detail': 'Already verified', 'status': 'paid'})
    
    # TODO: 这里可以添加区块链TXID验证逻辑
    # 简化版：直接标记为已支付（实际应该查询区块链）
    
    # 更新订单状态
    db.execute('UPDATE orders SET status = ?, txid = ?, paid_at = ? WHERE id = ?',
               ('paid', txid, datetime.now().isoformat(), order_id))
    
    # 开通会员
    tier = order['tier']
    credits = TIER_CONFIG[tier]['credits']
    db.execute('UPDATE users SET tier = ?, credits = credits + ? WHERE id = ?',
               (tier, credits, g.user['id']))
    db.commit()
    
    return jsonify({
        'status': 'paid',
        'tier': tier,
        'credits_added': credits,
        'message': f'支付验证成功！已开通 {tier} 会员，赠送 {credits} 次'
    })

@app.route('/api/v1/tiers', methods=['GET'])
def get_tiers():
    """获取会员等级信息"""
    return jsonify(TIER_CONFIG)

@app.route('/api/v1/user/info', methods=['GET'])
@token_required
def get_user_info():
    """获取当前用户完整信息（包括订单、自选股）"""
    db = get_db()
    user = dict(g.user)
    
    # 获取订单
    orders = db.execute('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
                       (g.user['id'],)).fetchall()
    user['orders'] = [dict(o) for o in orders]
    
    # 获取自选股
    stocks = db.execute('SELECT * FROM stocks WHERE user_id = ?',
                       (g.user['id'],)).fetchall()
    user['stocks'] = [dict(s) for s in stocks]
    
    # 清理密码
    del user['password']
    
    return jsonify(user)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'TrendRadar API'})

if __name__ == '__main__':
    init_db()
    print("📡 TrendRadar API starting on port 8080...")
    app.run(host='0.0.0.0', port=8080, debug=False)
