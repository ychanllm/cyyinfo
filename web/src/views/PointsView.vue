<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { LuckyWheel } from '@lucky-canvas/vue';
import { api, apiUpload } from '../api';
import { confetti } from '../utils/confetti';

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

// 特效状态
const justCheckedIn = ref(false); // 本次打卡成功 → 印章砸下动画
const boxShaking = ref(false); // 盲盒摇晃悬念
const wheelRef = ref(null); // LuckyWheel 实例
const pendingPrize = ref(null); // 已抽中、待轮盘停下后展示的奖品

// 头像
const avatarInput = ref(null);
const avatarUploading = ref(false);
const showAvatarPrompt = ref(false);

const wheelPrizes = computed(() => prizes.value.filter((p) => p.in_box));

// LuckyWheel 配置（手帐暖色系）
const WHEEL_COLORS = ['#fff7ec', '#ffe9d6', '#fde3cf', '#f9ddc4'];
const wheelBlocks = [{ padding: '10px', background: '#E88D67' }];
const wheelPrizesConfig = computed(() =>
  wheelPrizes.value.map((p, i) => ({
    background: WHEEL_COLORS[i % WHEEL_COLORS.length],
    fonts: [{ text: p.name, top: '16%', fontSize: '13px', fontColor: '#BE6A3E', fontWeight: '600' }],
  }))
);
const wheelButtons = [{
  radius: '30%',
  background: '#E88D67',
  pointer: true,
  fonts: [{ text: 'GO', top: '-10px', fontSize: '18px', fontColor: '#fff', fontWeight: '700' }],
}];

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
    // 无头像且本次会话未提示过时，提示设置头像
    showAvatarPrompt.value = !meData.avatar && !sessionStorage.getItem('avatar_prompt_dismissed');
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
    justCheckedIn.value = true;
    confetti();
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

// 盲盒：摇晃 1.5s 制造悬念后弹出结果
async function boxDraw() {
  acting.value = true;
  error.value = '';
  boxResult.value = null;
  boxShaking.value = true;
  try {
    const [data] = await Promise.all([
      api('/box/draw', { method: 'POST' }),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    boxResult.value = data.prize;
    confetti();
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    boxShaking.value = false;
    acting.value = false;
  }
}

// 轮盘：先拿中奖结果，再 play() → stop(中奖 index)，停下后弹结果
async function wheelDraw() {
  if (acting.value) return;
  if (status.value && status.value.balance < status.value.box_cost) {
    error.value = t('points.notEnough');
    return;
  }
  acting.value = true;
  error.value = '';
  boxResult.value = null;
  let data;
  try {
    data = await api('/box/draw', { method: 'POST' });
  } catch (e) {
    error.value = e.message;
    acting.value = false;
    return;
  }
  const idx = wheelPrizes.value.findIndex((p) => p.id === data.prize.id);
  if (idx < 0 || !wheelRef.value) {
    // 兜底：中奖奖品不在轮盘列表，直接弹窗
    boxResult.value = data.prize;
    confetti();
    acting.value = false;
    await load();
    return;
  }
  pendingPrize.value = data.prize;
  wheelRef.value.play();
  // 先转一会儿再停在中奖项
  setTimeout(() => wheelRef.value?.stop(idx), 2200);
}

// 轮盘停止回调：弹出中奖结果 + 撒花
function onWheelEnd() {
  if (!pendingPrize.value) return;
  boxResult.value = pendingPrize.value;
  pendingPrize.value = null;
  confetti();
  acting.value = false;
  load();
}

// 头像：点圆形头像/提示条选择图片上传
function pickAvatar() {
  avatarInput.value?.click();
}

function dismissAvatarPrompt() {
  sessionStorage.setItem('avatar_prompt_dismissed', '1');
  showAvatarPrompt.value = false;
}

async function uploadAvatar(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || avatarUploading.value) return;
  avatarUploading.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const data = await apiUpload('/users/me/avatar', form, false);
    me.value = { ...me.value, avatar: data.avatar };
    showAvatarPrompt.value = false;
  } catch (e2) {
    error.value = e2.message;
  } finally {
    avatarUploading.value = false;
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
      <!-- 无头像提示条 -->
      <div v-if="showAvatarPrompt" class="avatar-prompt">
        <span class="avatar-prompt-text" @click="pickAvatar">{{ t('points.avatarPrompt') }}</span>
        <button type="button" class="avatar-prompt-close" :aria-label="t('points.dismiss')" @click="dismissAvatarPrompt">×</button>
      </div>

      <!-- 签到卡片 -->
      <section class="card checkin-card">
        <div v-if="status.checked_in" class="stamp" :class="{ animated: justCheckedIn }">
          {{ t('points.stamp') }}
        </div>
        <div class="balance-row">
          <span class="hello-wrap">
            <button
              type="button"
              class="avatar-btn"
              :title="t('points.setAvatar')"
              :disabled="avatarUploading"
              @click="pickAvatar"
            >
              <img v-if="me?.avatar" :src="`/uploads/${me.avatar}`" class="avatar" :alt="me?.username" />
              <span v-else class="avatar placeholder">{{ (me?.username || '?').charAt(0).toUpperCase() }}</span>
            </button>
            <span class="hello">{{ t('points.hello', { name: me?.username }) }}</span>
          </span>
          <span class="balance">{{ t('points.balance', { n: status.balance }) }}</span>
        </div>
        <input ref="avatarInput" type="file" accept="image/*" hidden @change="uploadAvatar" />
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
      <section class="card box-card">
        <h3>{{ t('points.boxTitle') }}</h3>
        <p class="hint">{{ t('points.boxHint', { cost: status.box_cost }) }}</p>
        <div class="box-visual" :class="{ shaking: boxShaking }" aria-hidden="true">🎁</div>
        <button
          class="btn primary"
          :disabled="acting || status.balance < status.box_cost"
          @click="boxDraw"
        >{{ t('points.draw', { cost: status.box_cost }) }}</button>
        <p v-if="status.balance < status.box_cost" class="hint">{{ t('points.notEnough') }}</p>
      </section>

      <!-- 轮盘抽奖 -->
      <section class="card wheel-card">
        <h3>{{ t('points.wheelTitle') }}</h3>
        <p class="hint">{{ t('points.boxHint', { cost: status.box_cost }) }}</p>
        <template v-if="wheelPrizes.length">
          <div class="wheel-wrap">
            <LuckyWheel
              ref="wheelRef"
              width="240px"
              height="240px"
              :blocks="wheelBlocks"
              :prizes="wheelPrizesConfig"
              :buttons="wheelButtons"
              @start="wheelDraw"
              @end="onWheelEnd"
            />
          </div>
          <button
            class="btn primary"
            :disabled="acting || status.balance < status.box_cost"
            @click="wheelDraw"
          >{{ t('points.draw', { cost: status.box_cost }) }}</button>
        </template>
        <p v-else class="hint">{{ t('points.emptyPrizes') }}</p>
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
  position: relative;
  overflow: hidden;
}
/* 「已打卡」印章 */
.stamp {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 78px;
  height: 78px;
  border: 3px solid var(--color-primary);
  border-radius: 50%;
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  transform: rotate(-18deg);
  opacity: 0.85;
  pointer-events: none;
}
.stamp::after {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid var(--color-primary);
  border-radius: 50%;
}
/* 打卡成功：旋转 + 缩放砸下 */
.stamp.animated {
  animation: stamp-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes stamp-in {
  from { transform: rotate(-45deg) scale(2.6); opacity: 0; }
  to { transform: rotate(-18deg) scale(1); opacity: 0.85; }
}
/* 盲盒摇晃跳动 */
.box-card {
  text-align: center;
}
.box-visual {
  font-size: 64px;
  line-height: 1;
  margin: 8px 0 12px;
  user-select: none;
}
.box-visual.shaking {
  animation: box-shake 0.5s ease-in-out infinite;
}
@keyframes box-shake {
  0%, 100% { transform: rotate(0deg) translateY(0); }
  25% { transform: rotate(-8deg) translateY(-6px); }
  75% { transform: rotate(8deg) translateY(-6px); }
}
/* 轮盘 */
.wheel-card {
  text-align: center;
}
.wheel-wrap {
  margin: 14px auto;
  display: flex;
  justify-content: center;
}
.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.hello-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar-btn {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  border-radius: 50%;
}
.avatar-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
}
.avatar.placeholder {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.avatar-prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 14px;
}
.avatar-prompt-text {
  cursor: pointer;
  color: var(--color-primary);
}
.avatar-prompt-close {
  border: none;
  background: none;
  font-size: 18px;
  line-height: 1;
  color: var(--color-text-light);
  cursor: pointer;
  padding: 0 4px;
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
  animation: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes pop-in {
  from { transform: scale(0.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
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
