// ============================================================
// BRAINROT BOT v3 — Win the game
// ============================================================
(() => {
  'use strict';

  const BOT_GRAVITY = 0.28;
  const BOT_GROUND_H = 40;

  const PREDICT_FRAMES = 100;
  const DANGER_LOOKAHEAD = 40;
  const SHOOT_TOLERANCE = 24;
  const SAFETY_MARGIN = 12;

  const UPGRADE_PRIORITY = [
    'extraAmmo',
    'moveSpeed',
    'shotSpeed',
    'sizeReduction',
    'extraArrows',
    'extraLife',
  ];

  let menuCooldown = 0;
  let charSelectPhase = 0;
  let frameCount = 0;
  let lastLogState = '';
  let lastLogLevel = 0;

  // ============================================================
  // BALL TRAJECTORY PREDICTION
  // ============================================================
  function predictBall(b, frames, blocks, sc) {
    const positions = [];
    let bx = b.x, by = b.y, bvx = b.vx, bvy = b.vy;
    const br = b.r;
    const bounceVy = b.bounceVy;
    const groundY = H - BOT_GROUND_H * sc;
    const gameW = W;
    const ts = game.slowMoTimer > 0 ? 0.5 : 1;

    for (let f = 0; f < frames; f++) {
      bvy += BOT_GRAVITY * sc * ts;
      bx += bvx * ts;
      by += bvy * ts;

      if (bx - br < 0) { bx = br; bvx = Math.abs(bvx); }
      if (bx + br > gameW) { bx = gameW - br; bvx = -Math.abs(bvx); }
      if (by - br < 0) { by = br; bvy = Math.abs(bvy); }
      if (by + br > groundY) { by = groundY - br; bvy = bounceVy; }

      for (let bi = 0; bi < blocks.length; bi++) {
        const bl = blocks[bi];
        const nx = Math.max(bl.x, Math.min(bl.x + bl.w, bx));
        const ny = Math.max(bl.y, Math.min(bl.y + bl.h, by));
        const dx = bx - nx, dy = by - ny;
        const distSq = dx * dx + dy * dy;
        if (distSq < br * br) {
          const dist = Math.sqrt(distSq) || 0.01;
          bx += (dx / dist) * (br - dist);
          by += (dy / dist) * (br - dist);
          const overlapX = br - Math.abs(bx - (bl.x + bl.w / 2)) + bl.w / 2;
          const overlapY = br - Math.abs(by - (bl.y + bl.h / 2)) + bl.h / 2;
          if (overlapX < overlapY) { bvx = -bvx; }
          else { bvy = by < bl.y ? bounceVy : Math.abs(bvy); }
        }
      }

      positions.push({ x: bx, y: by, vx: bvx, vy: bvy, frame: f + 1 });
    }
    return positions;
  }

  // ============================================================
  // THREAT ASSESSMENT
  // ============================================================
  function buildDangerZones() {
    const sc = SCALE;
    const groundY = H - BOT_GROUND_H * sc;
    const pw = player.w * sc / 2;
    const playerTop = groundY - player.h * sc;
    const zones = [];

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const trajectory = predictBall(b, DANGER_LOOKAHEAD, game.blocks, sc);
      const check = [{ x: b.x, y: b.y, frame: 0 }];
      for (let k = 0; k < trajectory.length; k++) check.push(trajectory[k]);

      for (let j = 0; j < check.length; j++) {
        const pos = check[j];
        if (pos.y + b.r >= playerTop - SAFETY_MARGIN && pos.y - b.r <= groundY) {
          const timeFactor = 1 / (pos.frame + 1);
          const sizeFactor = 1 + (3 - b.tier) * 0.3;
          zones.push({
            xMin: pos.x - b.r - pw - SAFETY_MARGIN,
            xMax: pos.x + b.r + pw + SAFETY_MARGIN,
            severity: timeFactor * sizeFactor,
            frame: pos.frame,
          });
        }
      }
    }
    return zones;
  }

  function dangerAt(x, zones, maxFrame) {
    let total = 0;
    const limit = maxFrame !== undefined ? maxFrame : 9999;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.frame <= limit && x >= z.xMin && x <= z.xMax) total += z.severity;
    }
    return total;
  }

  // Is a ball overlapping our hitbox RIGHT NOW (with safety margin)?
  function isInImmediateDanger() {
    const sc = SCALE;
    const pw = player.w * sc / 2;
    const ph = player.h * sc / 2;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const cx = Math.max(player.x - pw, Math.min(player.x + pw, b.x));
      const cy = Math.max(player.y - ph, Math.min(player.y + ph, b.y));
      const dx = b.x - cx, dy = b.y - cy;
      const hitDist = b.r + SAFETY_MARGIN;
      if (dx * dx + dy * dy < hitDist * hitDist) return true;
    }
    return false;
  }

  // ============================================================
  // SAFE POSITION FINDER
  // ============================================================
  function findSafestPosition(currentX, zones, blocks, urgent) {
    const sc = SCALE;
    const pw = player.w * sc / 2;
    const groundY = H - BOT_GROUND_H * sc;
    const pTop = groundY - player.h * sc;
    const pBot = groundY;
    let bestX = currentX;
    let bestSafety = -Infinity;

    for (let x = pw + 5; x < W - pw - 5; x += 10) {
      let blocked = false;
      for (let bi = 0; bi < blocks.length; bi++) {
        const bl = blocks[bi];
        if (pBot > bl.y && pTop < bl.y + bl.h && x + pw > bl.x && x - pw < bl.x + bl.w) {
          blocked = true; break;
        }
      }
      if (blocked) continue;

      let safety = 0;
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (x >= z.xMin && x <= z.xMax) {
          const tw = z.frame <= 5 ? 50 : z.frame <= 12 ? 30 : 12;
          safety -= z.severity * tw;
        } else {
          const dist = Math.min(Math.abs(x - z.xMin), Math.abs(x - z.xMax));
          safety += Math.min(dist / 80, 1.5) * 0.3;
        }
      }
      safety -= Math.abs(x - currentX) * (urgent ? 0.025 : 0.006);
      safety -= Math.abs(x - W / 2) * 0.0005;

      if (safety > bestSafety) { bestSafety = safety; bestX = x; }
    }
    return bestX;
  }

  // ============================================================
  // POWERUP TARGETING — shield & slow are survival gold
  // ============================================================
  function findBestPowerup(dangerZones) {
    if (powerups.length === 0) return null;
    const sc = SCALE;
    const groundY = H - BOT_GROUND_H * sc;

    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < powerups.length; i++) {
      const p = powerups[i];
      // Only go for powerups near ground level (reachable)
      if (p.y < groundY - 80 * sc) continue;
      if (p.y > groundY + 20 * sc) continue;

      const dist = Math.abs(p.x - player.x);
      const danger = dangerAt(p.x, dangerZones, 15);

      let score = 0;
      // Shield is amazing
      if (p.type === 'shield') score += 80;
      else if (p.type === 'slow') score += 60;
      else if (p.type === 'doubleShot') score += 30;

      score -= dist * 0.15;
      score -= danger * 30;

      if (score > bestScore) { bestScore = score; best = { x: p.x, score }; }
    }

    // Only chase if it's worth it
    return best && best.score > 10 ? best : null;
  }

  // ============================================================
  // SPLIT SAFETY
  // ============================================================
  function isSplitSafe(b) {
    if (b.tier >= 3) return true;

    const sc = SCALE;
    const pw = player.w * sc / 2;
    const spreadVx = (2.2 + b.tier * 0.5) * sc;
    const childBounceVy = b.bounceVy * 0.7;
    const childTier = b.tier + 1;
    const childR = [45, 32, 22, 14][childTier] * sc;
    const childBVy = [-9.5, -9, -8.5, -8][childTier] * sc;

    const children = [
      { x: b.x - 10 * sc, y: b.y, vx: -spreadVx, vy: childBounceVy, r: childR, bounceVy: childBVy },
      { x: b.x + 10 * sc, y: b.y, vx: spreadVx, vy: childBounceVy, r: childR, bounceVy: childBVy },
    ];

    const ph = player.h * sc / 2;
    for (const child of children) {
      const traj = predictBall(child, 18, game.blocks, sc);
      for (const pos of traj) {
        if (pos.y + childR >= player.y - ph && pos.y - childR <= player.y + ph) {
          if (Math.abs(pos.x - player.x) < childR + pw + 8) return false;
        }
      }
    }
    return true;
  }

  // ============================================================
  // TARGET SELECTION
  // ============================================================
  function findBestTarget(dangerZones) {
    if (balls.length === 0) return null;

    const sc = SCALE;
    const groundY = H - BOT_GROUND_H * sc;
    const speedValues = [7, 9, 11, 13];
    const shotSpeed = speedValues[upgrades.shotSpeed] * sc;

    // Scale caution by level and ball count
    const levelCaution = Math.min(game.level * 0.15, 1.5); // higher levels = more cautious
    const crowded = balls.length >= 6;
    const veryCrowded = balls.length >= 9;

    const comboActive = game.comboTimer > 0;
    const comboUrgency = comboActive ? Math.min(game.combo * 12, 50) : 0;

    let bestTarget = null;
    let bestScore = -Infinity;

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];

      // When very crowded, ONLY shoot smallest balls
      if (veryCrowded && b.tier < 3) continue;
      // When crowded, avoid big balls
      if (crowded && b.tier < 2) continue;

      const trajectory = predictBall(b, PREDICT_FRAMES, game.blocks, sc);
      const positions = [{ x: b.x, y: b.y, frame: 0 }];
      for (let k = 0; k < trajectory.length; k += 2) positions.push(trajectory[k]);

      for (let j = 0; j < positions.length; j++) {
        const pos = positions[j];
        if (pos.y > groundY - 40 * sc) continue;
        if (pos.y < 10) continue;

        const shotTravelFrames = (groundY - pos.y) / shotSpeed;
        if (shotTravelFrames < 0) continue;

        const shootFrame = pos.frame - shotTravelFrames;
        if (shootFrame < -2) continue;

        const distToTarget = Math.abs(player.x - pos.x);
        const playerSpeed = player.speed * sc;
        const framesNeeded = distToTarget / playerSpeed;
        if (shootFrame > 0 && framesNeeded > shootFrame * 1.05) continue;

        const posDanger = dangerAt(pos.x, dangerZones, 15);

        let score = 100;
        score -= posDanger * (35 + levelCaution * 10); // more cautious at higher levels
        score -= Math.max(0, pos.frame) * 0.5;
        score += (3 - b.tier) * 30;
        score -= framesNeeded * 0.4;
        score -= distToTarget * 0.05;

        if (Math.abs(pos.x - player.x) < SHOOT_TOLERANCE * sc && pos.frame <= 3) {
          score += 80;
        }
        if (pos.y > groundY * 0.2 && pos.y < groundY * 0.6) {
          score += 15;
        }

        // Combo chasing
        if (comboActive) {
          const totalFrames = Math.max(framesNeeded, Math.max(0, shootFrame)) + shotTravelFrames;
          if (totalFrames < game.comboTimer) {
            score += comboUrgency;
            score += (90 - totalFrames) * 0.4;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestTarget = { x: pos.x, y: pos.y, ballIndex: i, tier: b.tier, frame: pos.frame, score };
        }
      }
    }

    return bestTarget;
  }

  // Ball directly above for opportunistic shots
  function ballAbovePlayer() {
    const sc = SCALE;
    const tol = SHOOT_TOLERANCE * sc;
    const groundY = H - BOT_GROUND_H * sc;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (Math.abs(b.x - player.x) < tol + b.r * 0.3 && b.y < groundY - 40 * sc) return b;
    }
    return null;
  }

  // ============================================================
  // MAIN BOT LOGIC
  // ============================================================
  function botThink() {
    frameCount++;

    if (game.state !== 'playing') {
      handleMenu();
      return;
    }

    // Logging
    if (frameCount % 180 === 0) {
      const comboStr = game.combo > 0 ? ` | Combo: x${game.combo}` : '';
      const stateKey = `L${game.level}-B${balls.length}-S${game.score}-V${game.lives}-C${game.combo}`;
      if (stateKey !== lastLogState) {
        console.log(`[BOT] Level ${game.level} | Balls: ${balls.length} | Score: ${game.score} | Lives: ${game.lives}${comboStr}`);
        lastLogState = stateKey;
      }
    }
    if (game.level !== lastLogLevel) {
      console.log(`[BOT] === LEVEL ${game.level} START ===`);
      lastLogLevel = game.level;
    }

    const sc = SCALE;
    const dangerZones = buildDangerZones();
    const immDanger = dangerAt(player.x, dangerZones, 12);
    const directDanger = isInImmediateDanger();
    const invincible = player.invincible > 0;

    // Dynamic danger threshold: more cautious on later levels / low lives
    const dangerThresh = 0.25 - game.level * 0.01 - (game.lives <= 1 ? 0.08 : 0);

    let targetX = player.x;
    let shouldShoot = false;

    // === PRIORITY 0: Collect nearby powerup if safe ===
    const pu = findBestPowerup(dangerZones);

    // === PRIORITY 1: Emergency dodge ===
    if (!invincible && (directDanger || immDanger > dangerThresh)) {
      targetX = findSafestPosition(player.x, dangerZones, game.blocks, true);
      shouldShoot = false;

    // === PRIORITY 2: Grab a good powerup ===
    } else if (pu && !directDanger) {
      targetX = pu.x;
      // Still shoot opportunistically while collecting
      const above = ballAbovePlayer();
      if (above && player.shootCooldown <= 0) shouldShoot = true;

    // === PRIORITY 3: Invincible — go aggressive ===
    } else if (invincible && player.invincible > 20) {
      const target = findBestTarget(dangerZones);
      if (target) {
        targetX = target.x;
        if (Math.abs(player.x - target.x) < SHOOT_TOLERANCE * sc * 1.5) shouldShoot = true;
      }

    // === PRIORITY 4: Normal play ===
    } else {
      const comboActive = game.comboTimer > 0;
      const target = findBestTarget(dangerZones);
      if (target) {
        const dangerLimit = comboActive ? dangerThresh * 4 : dangerThresh * 2;
        const pathDanger = dangerAt(target.x, dangerZones, 20);
        if (pathDanger < dangerLimit) {
          targetX = target.x;
          if (Math.abs(player.x - target.x) < SHOOT_TOLERANCE * sc) {
            const ball = balls[target.ballIndex];
            if (!ball) {
              // already popped
            } else if (ball.tier >= 3) {
              shouldShoot = true;
            } else if (isSplitSafe(ball)) {
              shouldShoot = true;
            } else if (comboActive && game.combo >= 3) {
              shouldShoot = true; // accept risk for combo
            }
          }
        } else {
          targetX = findSafestPosition(player.x, dangerZones, game.blocks, false);
        }
      } else {
        targetX = findSafestPosition(player.x, dangerZones, game.blocks, false);
      }
    }

    // Opportunistic shots
    if (!shouldShoot && player.shootCooldown <= 0) {
      const above = ballAbovePlayer();
      if (above && (invincible || isSplitSafe(above))) shouldShoot = true;
    }

    // Apply
    const diff = targetX - player.x;
    keys['ArrowLeft'] = diff < -2 * sc;
    keys['ArrowRight'] = diff > 2 * sc;

    if (shouldShoot && player.shootCooldown <= 0) {
      const totalArrows = 1 + upgrades.extraArrows;
      const maxShots = 2 * totalArrows + upgrades.extraAmmo * 2;
      if (shots.length < maxShots) shootRequest();
    }
  }

  // ============================================================
  // MENU NAVIGATION
  // ============================================================
  function handleMenu() {
    keys['ArrowLeft'] = false;
    keys['ArrowRight'] = false;

    if (menuCooldown > 0) { menuCooldown--; return; }

    switch (game.state) {
      case 'menu':
        console.log('[BOT] Starting game...');
        menuCooldown = 30;
        charSelectPhase = 0;
        startGame();
        break;

      case 'charSelect':
        if (charSelectPhase === 0) {
          selectChar(0);
          charSelectPhase = 1;
          menuCooldown = 10;
        } else {
          console.log('[BOT] Character selected, starting...');
          confirmCharAndStart();
          charSelectPhase = 0;
          menuCooldown = 30;
        }
        break;

      case 'levelIntro':
        menuCooldown = 20;
        game.state = 'playing';
        break;

      case 'upgradeSelect':
        handleUpgradeSelect();
        menuCooldown = 30;
        break;

      case 'gameOver':
        console.log(`[BOT] GAME OVER at level ${game.level} | Score: ${game.score}. Restarting...`);
        menuCooldown = 90;
        backToMenu();
        break;

      case 'win':
        console.log(`[BOT] *** YOU WIN! *** Score: ${game.score}`);
        // Signal Node.js to take screenshot and stop
        window.__botWon = true;
        // Disable further bot actions
        keys['ArrowLeft'] = false;
        keys['ArrowRight'] = false;
        break;

      case 'paused':
        break;
    }
  }

  // ============================================================
  // UPGRADE SELECTION
  // ============================================================
  function handleUpgradeSelect() {
    if (typeof upgradeChoices === 'undefined' || upgradeChoices.length === 0) return;

    let bestIndex = 0;
    let bestPriority = Infinity;

    for (let i = 0; i < upgradeChoices.length; i++) {
      const priority = UPGRADE_PRIORITY.indexOf(upgradeChoices[i].id);
      if (priority !== -1 && priority < bestPriority) {
        bestPriority = priority;
        bestIndex = i;
      }
    }

    // Emergency: grab life if we're low
    if (game.lives <= 1) {
      for (let i = 0; i < upgradeChoices.length; i++) {
        if (upgradeChoices[i].id === 'extraLife') { bestIndex = i; break; }
      }
    }

    console.log(`[BOT] Upgrade: picked "${upgradeChoices[bestIndex].name}" from [${upgradeChoices.map(u => u.name).join(', ')}]`);
    selectUpgrade(bestIndex);
  }

  // ============================================================
  // HOOK INTO GAME LOOP
  // ============================================================
  const originalUpdate = window.update;
  window.update = function () {
    originalUpdate();
    if (window.__botWon) return; // stop after winning
    try { botThink(); } catch (e) { console.error('[BOT ERROR]', e.message); }
  };

  console.log('[BOT] Brainrot Bot v3 activated — playing to win!');
})();
