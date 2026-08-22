// 撒花：基于 canvas-confetti，从视口顶部飘落
import fire from 'canvas-confetti';

// 手帐暖色系
const COLORS = ['#E88D67', '#BE6A3E', '#F4D9B6', '#F2B8A0', '#F6C453', '#ffffff'];

export function confetti(count = 36) {
  fire({
    particleCount: count,
    spread: 100,
    startVelocity: 28,
    gravity: 0.9,
    ticks: 220,
    origin: { y: 0 },
    colors: COLORS,
  });
}
