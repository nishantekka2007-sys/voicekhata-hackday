/**
 * GemmaKhata — app.js
 * Frontend logic: mic recording, Gemma extraction, ledger display, Chart.js dashboards
 */

// ================================================================
// State
// ================================================================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let extractedTransactions = [];
let trendChart = null;
let splitChart = null;

// ================================================================
// Tab Switching
// ================================================================
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'ledger') loadCustomers();
    if (tab === 'insights') loadInsights();
}

// ================================================================
// SCREEN 1: Voice Entry — Microphone Recording
// ================================================================
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: getMimeType() });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            sendAudioForTranscription(audioBlob);
        };

        mediaRecorder.start();
        isRecording = true;
        updateMicUI(true);

    } catch (err) {
        alert('Microphone access denied. Please allow microphone permission and try again.');
        console.error('Mic error:', err);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    isRecording = false;
    updateMicUI(false);
}

function getMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
}

function updateMicUI(recording) {
    const btn = document.getElementById('micBtn');
    const label = document.getElementById('micLabel');
    const pulse = document.getElementById('recordingPulse');
    const icon = document.getElementById('micIcon');

    if (recording) {
        btn.classList.add('recording');
        icon.textContent = '⏹️';
        label.style.display = 'none';
        pulse.style.display = 'flex';
    } else {
        btn.classList.remove('recording');
        icon.textContent = '🎙️';
        label.style.display = 'block';
        pulse.style.display = 'none';
    }
}

// ================================================================
// Send Audio → /api/transcribe (Step 2: faster-whisper)
// ================================================================
async function sendAudioForTranscription(audioBlob) {
    showLoader('Transcribing your voice with Whisper...');

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('language', document.getElementById('langSelect').value);

    try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        const data = await res.json();

        hideLoader();

        if (data.success && data.text) {
            document.getElementById('transcribedText').value = data.text;
            document.getElementById('transcriptionMeta').textContent =
                `Language: ${data.language_name} | Duration: ${data.duration_seconds}s | Processing: ${data.processing_time}s`;
            document.getElementById('transcriptionBox').style.display = 'block';
        } else {
            // Fallback: show empty text box for manual entry
            document.getElementById('transcribedText').value = '';
            document.getElementById('transcriptionMeta').textContent =
                data.error || 'Transcription failed. Type your transaction manually.';
            document.getElementById('transcriptionBox').style.display = 'block';
        }
    } catch (err) {
        hideLoader();
        document.getElementById('transcribedText').value = '';
        document.getElementById('transcriptionMeta').textContent = 'Server error. Type your transaction manually.';
        document.getElementById('transcriptionBox').style.display = 'block';
        console.error('Transcription error:', err);
    }
}

// ================================================================
// Extract Transactions → /api/extract (Step 3: Gemma AI)
// ================================================================
async function extractTransactions() {
    const text = document.getElementById('transcribedText').value.trim();
    if (!text) {
        alert('Please enter or record some text first.');
        return;
    }

    showLoader('Gemma AI is extracting transactions...');

    const formData = new FormData();
    formData.append('text', text);

    try {
        const res = await fetch('/api/extract', { method: 'POST', body: formData });
        const data = await res.json();

        hideLoader();

        if (data.success && data.transactions.length > 0) {
            extractedTransactions = data.transactions;
            renderTransactionCards(data.transactions);
        } else {
            alert(data.error || 'No transactions could be extracted. Please try rephrasing.');
        }
    } catch (err) {
        hideLoader();
        alert('Could not connect to Gemma AI. Make sure Ollama is running.');
        console.error('Extraction error:', err);
    }
}

// ================================================================
// Render Editable Transaction Cards (Step 4: Confirm)
// ================================================================
function renderTransactionCards(transactions) {
    const container = document.getElementById('cardContainer');
    container.innerHTML = '';

    transactions.forEach((tx, idx) => {
        const card = document.createElement('div');
        card.className = `tx-card ${tx.type}`;

        const missingHtml = tx.needs_confirmation
            ? `<span class="missing-badge">⚠️ Needs review</span>` : '';

        card.innerHTML = `
            ${missingHtml}
            <div class="card-row">
                <div class="card-field">
                    <label>Customer Name</label>
                    <input type="text" id="tx-name-${idx}" value="${tx.customer_name || ''}"
                           class="${!tx.customer_name ? 'missing' : ''}"
                           placeholder="Enter customer name">
                </div>
                <div class="card-field">
                    <label>Type</label>
                    <select id="tx-type-${idx}">
                        <option value="credit" ${tx.type === 'credit' ? 'selected' : ''}>🔴 Credit (Udhaar)</option>
                        <option value="payment" ${tx.type === 'payment' ? 'selected' : ''}>🟢 Payment (Jama)</option>
                    </select>
                </div>
            </div>
            <div class="card-row">
                <div class="card-field">
                    <label>Amount (₹)</label>
                    <input type="number" id="tx-amount-${idx}" value="${tx.amount || ''}"
                           class="${!tx.amount ? 'missing' : ''}"
                           placeholder="Enter amount" min="1" step="0.01">
                </div>
                <div class="card-field">
                    <label>Item / Description</label>
                    <input type="text" id="tx-item-${idx}" value="${tx.item_description || ''}"
                           placeholder="e.g. Chawal, Atta">
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    document.getElementById('transactionCards').style.display = 'block';
}

// ================================================================
// Confirm & Save → /api/transactions (Step 5: SQLite)
// ================================================================
async function confirmAndSave() {
    const transactions = [];
    const count = extractedTransactions.length;

    for (let i = 0; i < count; i++) {
        const name = document.getElementById(`tx-name-${i}`).value.trim();
        const type = document.getElementById(`tx-type-${i}`).value;
        const amount = parseFloat(document.getElementById(`tx-amount-${i}`).value);
        const item = document.getElementById(`tx-item-${i}`).value.trim();

        if (!name) { alert(`Please enter a customer name for transaction ${i + 1}.`); return; }
        if (!amount || amount <= 0) { alert(`Please enter a valid amount for transaction ${i + 1}.`); return; }

        transactions.push({
            customer_name: name,
            type: type,
            amount: amount,
            item_description: item
        });
    }

    showLoader('Saving transactions...');

    try {
        const res = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transactions: transactions,
                raw_voice_text: document.getElementById('transcribedText').value
            })
        });

        const data = await res.json();
        hideLoader();

        if (data.success) {
            document.getElementById('transactionCards').style.display = 'none';
            document.getElementById('transcriptionBox').style.display = 'none';
            document.getElementById('successMsg').style.display = 'block';
        } else {
            alert('Failed to save: ' + (data.detail || 'Unknown error'));
        }
    } catch (err) {
        hideLoader();
        alert('Error saving transactions. Check server connection.');
        console.error('Save error:', err);
    }
}

function clearVoiceEntry() {
    document.getElementById('transcriptionBox').style.display = 'none';
    document.getElementById('transactionCards').style.display = 'none';
    document.getElementById('successMsg').style.display = 'none';
    document.getElementById('transcribedText').value = '';
    document.getElementById('cardContainer').innerHTML = '';
    extractedTransactions = [];
}

// ================================================================
// SCREEN 2: Digital Ledger — Customer List
// ================================================================
let searchTimeout = null;

function searchCustomers() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadCustomers, 300);
}

async function loadCustomers() {
    const search = document.getElementById('customerSearch')?.value || '';

    try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}`);
        const data = await res.json();
        renderCustomerList(data.customers);
    } catch (err) {
        console.error('Load customers error:', err);
    }
}

function renderCustomerList(customers) {
    const list = document.getElementById('customerList');

    if (!customers || customers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span>📋</span>
                <p>No customers found. Record a voice transaction to get started!</p>
            </div>`;
        return;
    }

    list.innerHTML = customers.map(c => {
        const balanceClass = c.status;
        const absBalance = Math.abs(c.balance);
        const sign = c.balance >= 0 ? '' : '-';
        return `
            <div class="customer-card" onclick="openCustomerDetail(${c.id})">
                <div class="cust-info">
                    <h4>${escHtml(c.name)}</h4>
                    <span class="cust-meta">${c.transaction_count} transactions${c.last_transaction_date ? ' • Last: ' + c.last_transaction_date : ''}</span>
                </div>
                <div class="cust-balance">
                    <span class="amount ${balanceClass}">${sign}₹${absBalance.toLocaleString('en-IN')}</span>
                    <br><span class="status-tag ${balanceClass}">${c.status_label}</span>
                </div>
            </div>`;
    }).join('');
}

async function openCustomerDetail(customerId) {
    try {
        const res = await fetch(`/api/customers/${customerId}/transactions`);
        const data = await res.json();
        const c = data.customer;

        document.getElementById('modalCustomerName').textContent = c.customer_name + (c.phone ? ` (${c.phone})` : '');
        document.getElementById('modalBalance').innerHTML = `
            <div class="bal-item"><span class="bal-label">Credit</span><span class="bal-val text-red">₹${c.total_credit.toLocaleString('en-IN')}</span></div>
            <div class="bal-item"><span class="bal-label">Payments</span><span class="bal-val text-green">₹${c.total_payment.toLocaleString('en-IN')}</span></div>
            <div class="bal-item"><span class="bal-label">Balance</span><span class="bal-val">₹${Math.abs(c.balance).toLocaleString('en-IN')}</span><br><span class="status-tag ${c.status}">${c.status_label}</span></div>
        `;

        const txHtml = data.transactions.length > 0
            ? data.transactions.map(t => `
                <div class="tx-row">
                    <div class="tx-left">
                        <span class="tx-type ${t.type}">${t.type === 'credit' ? '🔴 Udhaar' : '🟢 Jama'}</span>
                        ${t.item_description ? `<div class="tx-item">${escHtml(t.item_description)}</div>` : ''}
                    </div>
                    <div class="tx-right">
                        <span class="tx-amount">₹${t.amount.toLocaleString('en-IN')}</span>
                        <div class="tx-date">${t.date}</div>
                    </div>
                </div>`).join('')
            : '<p style="text-align:center;color:#999;">No transactions yet.</p>';

        document.getElementById('modalTransactions').innerHTML = `<h4>Transaction History</h4>${txHtml}`;
        document.getElementById('customerModal').style.display = 'flex';

    } catch (err) {
        console.error('Customer detail error:', err);
    }
}

function closeModal(event) {
    if (!event || event.target === document.getElementById('customerModal')) {
        document.getElementById('customerModal').style.display = 'none';
    }
}

// ================================================================
// SCREEN 3: Quick Insights — Chart.js Dashboard
// ================================================================
async function loadInsights() {
    try {
        const res = await fetch('/api/insights');
        const data = await res.json();
        renderInsights(data);
    } catch (err) {
        console.error('Insights error:', err);
    }
}

function renderInsights(data) {
    // Summary Cards
    document.getElementById('totalCredit').textContent = `₹${data.total_credit.toLocaleString('en-IN')}`;
    document.getElementById('totalPayment').textContent = `₹${data.total_payment.toLocaleString('en-IN')}`;
    document.getElementById('netOutstanding').textContent = `₹${data.net_outstanding.toLocaleString('en-IN')}`;

    // Today's Stats
    document.getElementById('todayCredit').textContent = `₹${data.today_credit.toLocaleString('en-IN')}`;
    document.getElementById('todayPayment').textContent = `₹${data.today_payment.toLocaleString('en-IN')}`;
    document.getElementById('todayTxCount').textContent = data.today_transactions_count;

    // 7-Day Trend Chart (Bar Chart)
    renderTrendChart(data.chart_data);

    // Credit vs Payment Split (Doughnut)
    renderSplitChart(data.total_credit, data.total_payment);

    // Top Debtors
    const debtorList = document.getElementById('debtorList');
    if (data.top_debtors && data.top_debtors.length > 0) {
        debtorList.innerHTML = data.top_debtors.map((d, i) => `
            <div class="debtor-row">
                <span class="debtor-name">${i + 1}. ${escHtml(d.name)}</span>
                <span class="debtor-amount">₹${d.balance.toLocaleString('en-IN')}</span>
            </div>`).join('');
    } else {
        debtorList.innerHTML = '<p style="text-align:center;color:#999;">No pending debts. All settled!</p>';
    }

    // AI Summary
    document.getElementById('aiSummary').textContent = data.ai_summary || data.summary_text || 'No data yet.';
}

function renderTrendChart(chartData) {
    const ctx = document.getElementById('trendChart').getContext('2d');

    if (trendChart) trendChart.destroy();

    const labels = (chartData.labels || []).map(d => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
    });

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Credit (Udhaar)',
                    data: chartData.credit || [],
                    backgroundColor: 'rgba(214, 40, 40, 0.7)',
                    borderColor: '#d62828',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Payments (Jama)',
                    data: chartData.payment || [],
                    backgroundColor: 'rgba(45, 106, 79, 0.7)',
                    borderColor: '#2d6a4f',
                    borderWidth: 1,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: val => '₹' + val.toLocaleString('en-IN'),
                        font: { size: 10 }
                    }
                },
                x: { ticks: { font: { size: 10 } } }
            }
        }
    });
}

function renderSplitChart(credit, payment) {
    const ctx = document.getElementById('splitChart').getContext('2d');

    if (splitChart) splitChart.destroy();

    const total = credit + payment;
    if (total === 0) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet', ctx.canvas.width / 2, 110);
        return;
    }

    splitChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Credit (Udhaar)', 'Payments (Jama)'],
            datasets: [{
                data: [credit, payment],
                backgroundColor: ['rgba(214, 40, 40, 0.8)', 'rgba(45, 106, 79, 0.8)'],
                borderColor: ['#d62828', '#2d6a4f'],
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed;
                            const pct = ((val / total) * 100).toFixed(1);
                            return ` ₹${val.toLocaleString('en-IN')} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ================================================================
// Utilities
// ================================================================
function showLoader(text) {
    document.getElementById('loaderText').textContent = text || 'Processing...';
    document.getElementById('loader').style.display = 'block';
}

function hideLoader() {
    document.getElementById('loader').style.display = 'none';
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ================================================================
// Startup — Check AI status
// ================================================================
async function checkHealth() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const badge = document.getElementById('aiBadge');

        if (data.ollama.status === 'ready') {
            badge.textContent = '🤖 Gemma Ready';
            badge.style.background = 'rgba(45,180,79,0.3)';
        } else if (data.ollama.status === 'fallback') {
            badge.textContent = '🤖 Fallback Model';
            badge.style.background = 'rgba(255,193,7,0.3)';
        } else {
            badge.textContent = '🤖 AI Offline';
            badge.style.background = 'rgba(255,82,82,0.3)';
        }
    } catch (err) {
        const badge = document.getElementById('aiBadge');
        badge.textContent = '🤖 Server Offline';
        badge.style.background = 'rgba(255,82,82,0.3)';
    }
}

// Run on page load
document.addEventListener('DOMContentLoaded', () => {
    checkHealth();
});
