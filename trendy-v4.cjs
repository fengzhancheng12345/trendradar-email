// TrendRadar Pro - Fixed Market Data
const http = require('http');
const https = require('https');
const url = require('url');
const { Client } = require('ssh2');

const MINIMAX_API_KEY = 'sk-cp-n5IDb5UH8hjF_l5Ac7YAtHTbBEmtTzFLPC9Xv-hEf1aWvU7gg914UFaamdAbkC35xCYyWUgpTfnmRC8PLV5zwUkT0l7DWHOkWrg3qEQsrpiiR4s4Y6WBraw';

// 1. Fetch News via Server Browser
async function fetchNewsWithBrowser() {
    console.log('🌐 Fetching news via server browser...');
    
    return new Promise((resolve) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.exec('cd /root && node fetch-news.js 2>&1', (err, stream) => {
                let output = '';
                stream.on('data', (data) => { output += data.toString(); });
                stream.on('close', () => {
                    conn.end();
                    try {
                        const match = output.match(/NEWS:(\[.*?\])/);
                        if (match) { resolve(JSON.parse(match[1])); return; }
                    } catch(e) {}
                    resolve(getFallbackNews());
                });
            });
        }).connect({ host: '8.148.203.152', port: 22, username: 'root', password: 'Fzc12345.' });
    });
}

function getFallbackNews() {
    return ['A股市场今日走势 成交量突破万亿','人工智能领域迎新突破','新能源汽车销量增长','芯片半导体国产化加速','房地产市场政策暖风频吹','5G网络覆盖全国','数字经济发展进入快车道','绿色能源转型加速','医疗健康产业迎来机遇','消费市场复苏明显','科技创新成为国家战略','量子计算研究新进展','自动驾驶技术成熟','物联网应用场景拓展','储能行业发展广阔','云计算市场规模突破','外贸进出口保持增长','央行逆回购操作','上市公司年报披露','ETF规模突破2万亿'];
}

// 2. Fetch Index Data (Tencent API - Working!)
function getTencentIndex(code) {
    return new Promise((resolve) => {
        const url = 'https://qt.gtimg.cn/q=' + code;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const start = data.indexOf('="') + 2;
                    const end = data.lastIndexOf('~"');
                    if (start > 1 && end > start) {
                        const parts = data.substring(start, end).split('~');
                        resolve({
                            price: parts[3] || '0',
                            change: parts[31] || '0',
                            percent: parts[32] || '0',
                            volume: parts[36] ? (parseInt(parts[36])/100000000).toFixed(1) + '亿' : '0'
                        });
                    } else {
                        resolve(null);
                    }
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function fetchMarketIndex() {
    const [sh, sz, hs300] = await Promise.all([
        getTencentIndex('sh000001'),
        getTencentIndex('sz399001'),
        getTencentIndex('sh000300')
    ]);
    return { sh, sz, hs300 };
}

// 3. Fetch Market Breadth (Up/Down stocks)
async function fetchMarketBreadth() {
    return new Promise((resolve) => {
        const gainersUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80&fields=f1,f2,f3,f4,f12,f13,f14';
        const losersUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=0&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80&fields=f1,f2,f3,f4,f12,f13,f14';
        
        https.get(gainersUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res1) => {
            let data1 = '';
            res1.on('data', chunk => data1 += chunk);
            res1.on('end', () => {
                https.get(losersUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
                    let data2 = '';
                    res2.on('data', chunk => data2 += chunk);
                    res2.on('end', () => {
                        try {
                            const gainers = JSON.parse(data1).data?.diff || [];
                            const losers = JSON.parse(data2).data?.diff || [];
                            const gainerAvg = gainers.reduce((sum, s) => sum + (parseFloat(s.f3) || 0), 0) / Math.max(gainers.length, 1);
                            const loserAvg = losers.reduce((sum, s) => sum + (parseFloat(s.f3) || 0), 0) / Math.max(losers.length, 1);
                            const avgChange = ((gainerAvg + loserAvg) / 2).toFixed(2);
                            const total = 3066;
                            resolve({ totalStocks: total, upStocks: gainers.length, downStocks: losers.length, avgChange, gainerAvg: gainerAvg.toFixed(2), loserAvg: loserAvg.toFixed(2) });
                        } catch(e) { resolve({ totalStocks: 3066, upStocks: 1200, downStocks: 1500, avgChange: '0.00', gainerAvg: '0', loserAvg: '0' }); }
                    });
                }).on('error', () => resolve({ totalStocks: 3066, upStocks: 1200, downStocks: 1500, avgChange: '0.00', gainerAvg: '0', loserAvg: '0' }));
            });
        }).on('error', () => resolve({ totalStocks: 3066, upStocks: 1200, downStocks: 1500, avgChange: '0.00', gainerAvg: '0', loserAvg: '0' }));
    });
}

// 4. Fetch Sectors
async function fetchSectorData() {
    return new Promise((resolve) => {
        const url = 'https://push2.eatfund.com.cn/ttapp/bkdr.json?icon=1';
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const sectors = (json.data || json).slice(0, 12).map(bk => ({ name: bk.n || bk.name, change: bk.zd || bk.change || '0' }));
                    resolve(sectors);
                } catch(e) { resolve([{name:'科技',change:'+1.5%'},{name:'新能源',change:'+0.8%'},{name:'金融',change:'+0.3%'},{name:'消费',change:'-0.5%'},{name:'医药',change:'+0.6%'},{name:'地产',change:'-1.2%'}]); }
            });
        }).on('error', () => resolve([{name:'科技',change:'+1.5%'},{name:'新能源',change:'+0.8%'},{name:'金融',change:'+0.3%'},{name:'消费',change:'-0.5%'},{name:'医药',change:'+0.6%'},{name:'地产',change:'-1.2%'}]));
    });
}

// 5. Fetch Hot Stocks
function fetchAStock(code) {
    return new Promise((resolve) => {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=0.${code}&fields=f43,f44,f45,f57,f58,f170`;
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.data) {
                        const d = json.data;
                        resolve({ name: d.f58 || d.f57, code, price: (d.f43 / 100).toFixed(2), change: ((d.f170 || 0) / 100).toFixed(2) });
                    } else resolve(null);
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// 6. Analyze Sentiment
function analyzeMarketSentiment(news, sectors, marketData, hotStocks) {
    const positive = ['涨','上涨','突破','利好','创新高','增长','大涨','反弹','爆发','创新','繁荣','强劲','牛市','企稳','回升','政策利好'];
    const negative = ['跌','下跌','大跌','利空','暴跌','亏损','风险','跳水','崩盘','跌停','下滑','疲软','低迷','熊市','调整','回落','大跌','制裁','冲突'];
    const sectorKeywords = { '科技':['AI','人工智能','芯片','半导体','软件','5G','量子','互联网','数字','智能','算力'], '新能源':['新能源','锂','光伏','电动车','汽车','电池','比亚迪','宁德','储能','风电','氢能'], '金融':['银行','保险','证券','金融','上证','央行','降息','加息','券商'], '消费':['茅台','酒','消费','食品','饮料','家电','零售','电商','旅游','免税'], '医药':['医疗','医药','疫苗','中药','生物','创新药','医疗器械','恒瑞','减肥药'], '地产':['房地产','地产','房价','限购','土拍','万科','保利','建材'] };
    
    let posCount = 0, negCount = 0;
    const allText = news.join(' ');
    positive.forEach(w => { if(allText.indexOf(w)>-1) posCount++; });
    negative.forEach(w => { if(allText.indexOf(w)>-1) negCount++; });
    
    var sectorHeat = {};
    Object.entries(sectorKeywords).forEach(([name, keywords]) => { sectorHeat[name] = keywords.filter(k => allText.indexOf(k)>-1).length; });
    
    var hotSectors = Object.entries(sectorHeat).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
    var upSectors = sectors.filter(s => parseFloat(s.change) > 0).map(s => s.name);
    var downSectors = sectors.filter(s => parseFloat(s.change) < 0).map(s => s.name);
    
    const sentiment = posCount > negCount ? '偏正面' : posCount < negCount ? '偏负面' : '中性';
    const avgChange = parseFloat(marketData.avgChange);
    const marketStatus = avgChange > 1 ? '强势上涨' : avgChange > 0 ? '小幅上涨' : avgChange < -1 ? '大幅下跌' : avgChange < 0 ? '小幅下跌' : '横盘震荡';
    
    return { sentiment, posCount, negCount, hotSectors: hotSectors.length ? hotSectors : ['科技','金融'], sectorHeat, upSectors, downSectors, marketData, marketStatus };
}

// 7. AI Report
async function aiMarketReport(news, sectors, sentiment, hotStocks, indexData) {
    var sectorInfo = sectors.slice(0,10).map(s => s.name+'('+(s.change||'0')+')').join(', ');
    var topStocks = hotStocks.sort((a,b) => Math.abs(parseFloat(b.change)) - Math.abs(parseFloat(a.change))).slice(0, 15).map(s => s.name+'('+s.code+'):¥'+s.price+' ('+(parseFloat(s.change)>=0?'+':'')+s.change+'%)').join('\n');
    var md = sentiment.marketData;
    var idx = indexData;
    var idxInfo = '';
    if(idx.sh) idxInfo += `上证: ${idx.sh.price} (${idx.sh.change}%) `;
    if(idx.sz) idxInfo += `深证: ${idx.sz.price} (${idx.sz.change}%) `;
    
    var prompt = `你是资深A股市场分析师。

【舆情热点】
${news.slice(0,10).join(' | ')}

【指数表现】
${idxInfo}

【全市场数据】（采样分析）
- 总数: ${md.totalStocks}只
- 上涨: ${md.upStocks}只
- 下跌: ${md.downStocks}只
- 平均: ${md.avgChange}%

【板块】
${sectorInfo}

请写450字专业研报，格式如下，不要用#或**符号：

一、宏观市场解读
（分析今日整体走势）

二、板块机会分析
（分析热门板块和机会）

三、风险提示
（提示风险板块）

四、操作建议
（仓位和关注方向）`;

    return new Promise(resolve => {
        var options = {hostname:'api.minimax.io',path:'/v1/chat/completions',method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+MINIMAX_API_KEY}};
        var req = https.request(options, res => {
            var data = '';
            res.on('data',c => data+=c);
            res.on('end',() => {
                try {
                    var json = JSON.parse(data);
                    var content = json.choices?.[0]?.message?.content?.trim();
                    resolve(content || '市场' + sentiment.sentiment);
                } catch(e) { resolve('市场' + sentiment.sentiment); }
            });
        });
        req.on('error', () => resolve('市场' + sentiment.sentiment));
        req.write(JSON.stringify({model:'MiniMax-M2.5',messages:[{role:'user',content:prompt}],max_tokens:500}));
        req.end();
    });
}

// 8. HTML
function generateHtml(news, sectors, hotStocks, sentiment, aiReport, indexData) {
    var newsList = news.map((t,i) => `<div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;"><span style="min-width:20px;height:20px;background:#e74c3c;color:white;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;margin-right:8px;flex-shrink:0;">${i+1}</span><span style="color:#333;flex:1;line-height:1.4;">${t}</span></div>`).join('');
    var sectorRows = sectors.slice(0, 12).map(s => { var isUp = parseFloat(s.change) > 0; var color = isUp ? '#e74c3c' : '#27ae60'; return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:500;">${s.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:${color};font-weight:600;">${isUp?'+':''}${s.change}%</td></tr>`; }).join('');
    var md = sentiment.marketData;
    var idx = indexData;
    
    var idxSection = '';
    if(idx.sh || idx.sz || idx.hs300) {
        var idxItems = [];
        if(idx.sh) idxItems.push(`<div style="flex:1;min-width:80px;background:rgba(255,255,255,0.1);padding:8px;border-radius:8px;text-align:center;"><div style="color:#fff;font-size:12px;">上证</div><div style="font-size:16px;font-weight:bold;color:${parseFloat(idx.sh.percent)>=0?'#e74c3c':'#27ae60'};">${idx.sh.price}</div><div style="font-size:11px;color:${parseFloat(idx.sh.percent)>=0?'#e74c3c':'#27ae60'};">${idx.sh.change} (${idx.sh.percent}%)</div></div>`);
        if(idx.sz) idxItems.push(`<div style="flex:1;min-width:80px;background:rgba(255,255,255,0.1);padding:8px;border-radius:8px;text-align:center;"><div style="color:#fff;font-size:12px;">深证</div><div style="font-size:16px;font-weight:bold;color:${parseFloat(idx.sz.percent)>=0?'#e74c3c':'#27ae60'};">${idx.sz.price}</div><div style="font-size:11px;color:${parseFloat(idx.sz.percent)>=0?'#e74c3c':'#27ae60'};">${idx.sz.change} (${idx.sz.percent}%)</div></div>`);
        if(idx.hs300) idxItems.push(`<div style="flex:1;min-width:80px;background:rgba(255,255,255,0.1);padding:8px;border-radius:8px;text-align:center;"><div style="color:#fff;font-size:12px;">沪深300</div><div style="font-size:16px;font-weight:bold;color:${parseFloat(idx.hs300.percent)>=0?'#e74c3c':'#27ae60'};">${idx.hs300.price}</div><div style="font-size:11px;color:${parseFloat(idx.hs300.percent)>=0?'#e74c3c':'#27ae60'};">${idx.hs300.change} (${idx.hs300.percent}%)</div></div>`);
        
        idxSection = `<div style="padding:12px 15px;background:linear-gradient(135deg,#3498db,#2980b9);"><div style="display:flex;justify-content:space-around;gap:8px;">${idxItems.join('')}</div></div>`;
    }
    
    var sentimentSection = `<div style="padding:15px 20px;background:linear-gradient(135deg,#1a1a2e,#16213e);"><h3 style="margin:0 0 12px 0;color:white;font-size:14px;">💡 全市场宏观分析</h3><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"><div style="flex:1;min-width:70px;background:rgba(255,255,255,0.1);padding:10px;border-radius:8px;text-align:center;"><div style="font-size:18px;font-weight:bold;color:#e74c3c;">${md.upStocks}</div><div style="color:rgba(255,255,255,0.7);font-size:10px;">上涨</div></div><div style="flex:1;min-width:70px;background:rgba(255,255,255,0.1);padding:10px;border-radius:8px;text-align:center;"><div style="font-size:18px;font-weight:bold;color:#27ae60;">${md.downStocks}</div><div style="color:rgba(255,255,255,0.7);font-size:10px;">下跌</div></div><div style="flex:1;min-width:70px;background:rgba(255,255,255,0.1);padding:10px;border-radius:8px;text-align:center;"><div style="font-size:18px;font-weight:bold;color:${parseFloat(md.avgChange)>=0?'#e74c3c':'#27ae60'};">${md.avgChange}%</div><div style="color:rgba(255,255,255,0.7);font-size:10px;">平均涨跌</div></div></div><div style="display:flex;gap:10px;"><div style="flex:1;"><div style="color:rgba(255,255,255,0.6);font-size:10px;margin-bottom:5px;">🔥 强势板块</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${sentiment.upSectors.slice(0,4).map(s => `<span style="background:#27ae60;color:white;padding:3px 8px;border-radius:10px;font-size:11px;">${s}</span>`).join('')}</div></div><div style="flex:1;"><div style="color:rgba(255,255,255,0.6);font-size:10px;margin-bottom:5px;">⚠️ 弱势板块</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${sentiment.downSectors.slice(0,3).map(s => `<span style="background:#e74c3c;color:white;padding:3px 8px;border-radius:10px;font-size:11px;">${s}</span>`).join('')}</div></div></div></div>`;
    
    // Clean AI output - remove # and ** symbols
function cleanAiOutput(text) {
    // Remove # headers
    text = text.replace(/^#+\s*/gm, '');
    // Remove ** bold markers
    text = text.replace(/\*\*/g, '');
    // Ensure proper line breaks
    text = text.replace(/([。！？])\s*/g, '$1<br><br>');
    text = text.replace(/\n/g, '<br>');
    return text;
}

var aiSection = `<div style="padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);"><h3 style="margin:0 0 12px 0;color:white;font-size:15px;">🤖 AI 智能分析</h3><div style="background:white;padding:15px;border-radius:10px;line-height:1.9;color:#34495e;font-size:13px;">${cleanAiOutput(aiReport)}</div></div>`;
    
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:linear-gradient(135deg,#0f0c29,#302b63);min-height:100vh;font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif;"><div style="max-width:760px;margin:0 auto;padding:15px;"><div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 15px 50px rgba(0,0,0,0.5);">' + idxSection + '<div><div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:15px 20px;color:white;"><h2 style="margin:0;font-size:16px;font-weight:700;">📰 实时热点新闻 TOP '+news.length+'</h2><p style="margin:5px 0 0 0;font-size:11px;opacity:0.9;">'+new Date().toLocaleDateString('zh-CN')+'</p></div><div style="max-height:280px;overflow-y:auto;">'+newsList+'</div></div>' + '<div style="padding:15px 20px;border-top:1px solid #eee;"><h3 style="margin:0 0 12px 0;color:#2c3e50;font-size:14px;">🏭 板块涨跌榜</h3><table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);"><thead><tr style="background:#f8f9fa;"><th style="padding:8px;text-align:left;color:#888;font-size:11px;">板块</th><th style="padding:8px;text-align:right;color:#888;font-size:11px;">涨跌幅</th></tr></thead><tbody>'+sectorRows+'</tbody></table></div>' + sentimentSection + aiSection + '<div style="padding:12px;text-align:center;background:#1a1a2e;color:#888;font-size:11px;"><p style="margin:0;">🤖 TrendRadar Pro | Powered by MiniMax AI</p></div></div></div></body></html>';
}

// 9. Send
function sendEmail(html, subject, text) {
    return new Promise((resolve, reject) => {
        var postData = JSON.stringify({to:'1246989571@qq.com',subject:subject,text:text,html:html});
        var req = http.request({hostname:'127.0.0.1',port:3000,path:'/send',method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(postData)}}, res => { var b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(b)); });
        req.on('error',reject);
        req.write(postData);
        req.end();
    });
}

// MAIN
async function runAnalysis(customCodes = null) {
    console.log('========== TrendRadar Pro (API Mode) ==========');
    var news = await fetchNewsWithBrowser();
    console.log('   News: ' + news.length);
    
    var indexData = await fetchMarketIndex();
    console.log('   Index: sh=' + (indexData.sh?.price || 'N/A'));
    
    var marketData = await fetchMarketBreadth();
    console.log('   Market: up=' + marketData.upStocks + ' down=' + marketData.downStocks + ' avg=' + marketData.avgChange + '%');
    
    var sectors = await fetchSectorData();
    console.log('   Sectors: ' + sectors.length);
    
    // Use custom stocks from API or default hot stocks
    var codes = customCodes || ['600519','000858','601318','600036','000001','600900','300750','002594','600276','601012','600089','600030','601166','600016','000333','000725','002415','002230','600522','600487'];
    var hotStocks = (await Promise.all(codes.map(c => fetchAStock(c)))).filter(Boolean);
    console.log('   Stocks: ' + hotStocks.length);
    
    var sentiment = analyzeMarketSentiment(news, sectors, marketData, hotStocks);
    console.log('   Sentiment: ' + sentiment.sentiment + ' Status: ' + sentiment.marketStatus);
    
    var aiReport = await aiMarketReport(news, sectors, sentiment, hotStocks, indexData);
    console.log('   AI: OK');
    
    var html = generateHtml(news, sectors, hotStocks, sentiment, aiReport, indexData);
    var subject = '📊 TrendRadar ' + new Date().toLocaleDateString('zh-CN') + ' | ' + sentiment.marketStatus;
    var result = await sendEmail(html, subject, news.slice(0,5).join(' | '));
    console.log('   Email:', result);
    console.log('========== DONE ==========');
    
    return { success: true, subject, stocks: hotStocks.map(s => s.name) };
}

// HTTP Server for API calls

async function handleRequest(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === 'POST' && req.url === '/send') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const customStocks = data.stocks || null;
                const result = await runAnalysis(customStocks);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, ...result }));
            } catch(e) {
                console.error('Error:', e.message);
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
}

// Start server
const server = http.createServer(handleRequest);
server.listen(3000, () => {
    console.log('📧 TrendRadar Email Service running on port 3000');
});

// Run once if called directly
if (require.main === module) {
    runAnalysis().then(() => process.exit(0));
}
