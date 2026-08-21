<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';

const { t } = useI18n();

const me = ref(null);
const status = ref(null); // {checked_in, streak_day, balance, box_cost, next_points}
const prizes = ref([]);
const myPrizes = ref([]);
const error = ref('');
const loading = ref(true);
const acting = ref(false); // 防重复点击

// 盲盒结果弹窗
const boxResult = ref(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [meData, statusData, prizeList, myList] = await Promise.all([
      api('/auth/me'),
      api('/checkin/status'),
      api('/prizes'),
      api('/my/prizes'),
    ]);
    me.value = meData;
    status.value = statusData;
    prizes.value = prizeList;
    myPrizes.value = myList;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function checkin() {
  acting.value = true;
  error.value = '';
  try {
    await api('/checkin', { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function draw() {
  acting.value = true;
  error.value = '';
  boxResult.value = null;
  try {
    const data = await api('/box/draw', { method: 'POST' });
    boxResult.value = data.prize;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function redeem(prize) {
  if (!confirm(t('points.confirmRedeem', { name: prize.name, cost: prize.points_cost }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/prizes/${prize.id}/redeem`, { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function useRecord(rec) {
  if (!confirm(t('points.confirmUse', { name: rec.name }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/my/prizes/${rec.id}/use`, { method: 'POST' });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="points-page">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('points.loading') }}</p>

    <template v-else-if="status">
      <!-- 签到卡片 -->
      <section class="card checkin-card">
        <div class="balance-row">
          <span class="hello">{{ t('points.hello', { name: me?.username }) }}</span>
          <span class="balance">{{ t('points.balance', { n: status.balance }) }}</span>
        </div>
        <p class="streak">{{ t('points.streak', { n: status.streak_day }) }}</p>
        <button
          class="btn primary big"
          :disabled="acting || status.checked_in"
          @click="checkin"
        >
          {{ status.checked_in
            ? t('points.checkedIn')
            : t('points.checkinNow', { n: status.next_points }) }}
        </button>
        <p v-if="status.checked_in" class="hint">{{ t('points.tomorrow', { n: status.next_points }) }}</p>
      </section>

      <!-- 盲盒 -->
      <section class="card">
        <h3>{{ t('points.boxTitle') }}</h3>
        <p class="hint">{{ t('points.boxHint', { cost: status.box_cost }) }}</p>
        <button
          class="btn primary"
          :disabled="acting || status.balance < status.box_cost"
          @click="draw"
        >{{ t('points.draw', { cost: status.box_cost }) }}</button>
        <p v-if="status.balance < status.box_cost" class="hint">{{ t('points.notEnough') }}</p>
      </section>

      <!-- 奖品商城 -->
      <section class="card">
        <h3>{{ t('points.mallTitle') }}</h3>
        <p v-if="!prizes.length" class="hint">{{ t('points.emptyPrizes') }}</p>
        <ul v-else class="prize-grid">
          <li v-for="p in prizes" :key="p.id" class="prize-item">
            <img v-if="p.image" :src="`/uploads/${p.image}`" class="prize-img" :alt="p.name" />
            <div class="prize-body">
              <p class="prize-name">{{ p.name }}</p>
              <p v-if="p.description" class="prize-desc">{{ p.description }}</p>
              <div class="prize-actions">
                <button
                  v-if="p.points_cost > 0"
                  class="btn"
                  :disabled="acting || !p.in_stock || status.balance < p.points_cost"
                  @click="redeem(p)"
                >
                  {{ p.in_stock ? t('points.redeem', { cost: p.points_cost }) : t('points.soldOut') }}
                </button>
                <span v-else class="tag">{{ t('points.boxOnly') }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- 我的奖品 -->
      <section class="card">
        <h3>{{ t('points.myPrizes') }}</h3>
        <p v-if="!myPrizes.length" class="hint">{{ t('points.emptyMy') }}</p>
        <ul v-else class="record-list">
          <li v-for="r in myPrizes" :key="r.id" class="record-item">
            <div class="record-info">
              <span class="record-name">{{ r.name }}</span>
              <span class="record-meta">
                {{ r.source === 'box' ? t('points.fromBox') : t('points.fromRedeem') }} ·
                {{ r.points_spent }} {{ t('points.pointsUnit') }} ·
                {{ r.created_at }}
              </span>
            </div>
            <span v-if="r.status === 'used'" class="tag used">{{ t('points.statusUsed') }}</span>
            <span v-else-if="r.status === 'cancelled'" class="tag">{{ t('points.statusCancelled') }}</span>
            <button v-else class="btn" :disabled="acting" @click="useRecord(r)">{{ t('points.use') }}</button>
          </li>
        </ul>
      </section>
    </template>

    <!-- 盲盒结果弹窗 -->
    <div v-if="boxResult" class="modal-mask" @click.self="boxResult = null">
      <div class="modal">
        <h3>{{ t('points.boxWin') }}</h3>
        <img v-if="boxResult.image" :src="`/uploads/${boxResult.image}`" class="prize-img" :alt="boxResult.name" />
        <p class="win-name">{{ boxResult.name }}</p>
        <p v-if="boxResult.description" class="hint">{{ boxResult.description }}</p>
        <button class="btn primary" @click="boxResult = null">{{ t('points.ok') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.points-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 90px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
  margin-bottom: 20px;
}
.card h3 {
  font-size: 16px;
  margin: 0 0 10px;
}
.checkin-card {
  text-align: center;
}
.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.hello {
  font-size: 15px;
}
.balance {
  font-size: 18px;
  color: var(--color-primary);
  font-weight: 600;
}
.streak {
  font-size: 14px;
  color: var(--color-text-light);
  margin-bottom: 14px;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
.btn.big {
  padding: 12px 32px;
  font-size: 16px;
  margin-bottom: 8px;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.prize-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  padding: 0;
}
.prize-item {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}
.prize-img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  display: block;
}
.prize-body {
  padding: 10px 12px;
}
.prize-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}
.prize-desc {
  font-size: 12px;
  color: var(--color-text-light);
  margin: 0 0 8px;
}
.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.tag.used {
  background: #e6f6ec;
  color: #1e8e4f;
}
.record-list {
  list-style: none;
  padding: 0;
}
.record-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.record-item:last-child {
  border-bottom: none;
}
.record-info {
  flex: 1;
  min-width: 0;
}
.record-name {
  display: block;
  font-size: 14px;
}
.record-meta {
  font-size: 12px;
  color: var(--color-text-light);
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.modal {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 28px 32px;
  text-align: center;
  max-width: 320px;
  width: 100%;
}
.modal .prize-img {
  border-radius: 8px;
  margin-bottom: 10px;
}
.win-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
  margin: 4px 0 8px;
}
.modal .btn {
  margin-top: 12px;
}
</style>
