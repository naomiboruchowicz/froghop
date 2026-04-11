const CANVAS_W = 700;
const CANVAS_H = 300;
const GROUND_Y = CANVAS_H - CANVAS_H / 5;

const BASE_SPEED = 4;
const GRAVITY = 0.55;
const JUMP_IMPULSE = -12;

const FROG_W = 90;
const FROG_H = 70;
const FROG_DUCK_H = 50;
const FROG_JUMP_H = 30;

const SNAKE_SCORE_THRESHOLD = 150;
const SNAKE_SPAWN_DELAY_MIN = 2200;
const SNAKE_SPAWN_DELAY_MAX = 3500;
const SNAKE_W = 140;
const SNAKE_H = 200;
const SNAKE_CLEARANCE = 6;
const SNAKE_HITBOX_W = 38;
const SNAKE_HITBOX_H = 170;
const SNAKE_HITBOX_INSET_TOP = 25;
const LOG_W = 60;
const LOG_H = 60;
const LOG_HITBOX_W = 48;
const LOG_HITBOX_H = 22;
const ROCK_W = 70;
const ROCK_H = 45;
const ROCK_HITBOX_W = 56;
const ROCK_HITBOX_H = 18;
const FROG_HITBOX_INSET_X = 22;
const FROG_HITBOX_INSET_TOP = 18;
const FROG_HITBOX_W = 46;
const FROG_HITBOX_H = 52;

let frog = null;
let obstacles = [];
let snakes = [];
let score = 0;
let speed = BASE_SPEED;
let gameOver = false;
let gamePaused = false;
let spawnTimer = 0;
let bgOffset = 0;
let groundOffset = 0;
let highScore = 0;

let jungleImg = null;
let groundImg = null;
let frogRunImg = null;
let frogJumpImg = null;
let frogDuckImg = null;
let snakeImg = null;
let logImg = null;
let rockImg = null;
let pixelFont = null;

// --- Camera / Pose Detection ---
let video = null;
let bodyPose = null;
let poses = [];
const CAM_W = 140;
const CAM_H = 105;
const CAM_MARGIN = 8;
const VIDEO_W = 320;
const VIDEO_H = 240;

let poseHistory = []; // [{t: millis, y: noseY}, ...]
const WINDOW_MS = 120; // tight window: responsive but enough samples to filter jitter

// Calibration removed - speed-based detection doesn't need a baseline

// Speed thresholds (px per 100ms). Only fast, intentional movements trigger.
// Slow leans/nods won't hit these. Negative = upward, positive = downward.
const JUMP_THRESHOLD = -7;
const DUCK_THRESHOLD = 12;
let cooldown = false;
const JUMP_COOLDOWN_MS = 1000;
const DUCK_DURATION_MS = 700;
const DUCK_RECOVERY_MS = 500;
const DUCK_CONFIRM_MS = 100; // wait this long before committing to duck (pre-jump crouch cancels it)
let bodyState = "neutral";
let duckPending = false;
let duckPendingTimer = null;

// --- Game state machine ---
let gameState = "start";
let startButtonHover = false;
let readyButtonHover = false;

// --- CSS scaling helpers ---
let canvasEl = null;
function gameMouseX() {
  if (!canvasEl) return mouseX;
  return mouseX * (CANVAS_W / canvasEl.clientWidth);
}
function gameMouseY() {
  if (!canvasEl) return mouseY;
  return mouseY * (CANVAS_H / canvasEl.clientHeight);
}

function preload() {
  jungleImg = loadImage("assets/jungle.png");
  groundImg = loadImage("assets/ground.png");
  logImg = loadImage("assets/log.png");
  rockImg = loadImage("assets/rock.png");
  frogRunImg = loadImage("assets/frog_run.png");
  frogJumpImg = loadImage("assets/frog_jump.png");
  frogDuckImg = loadImage("assets/frog_duck.png");
  snakeImg = loadImage("assets/snake.png");
  pixelFont = loadFont("https://cdn.jsdelivr.net/npm/@fontsource/press-start-2p@5.0.0/files/press-start-2p-latin-400-normal.woff");
}

function setup() {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const container = document.getElementById("game-container");
  if (container) canvas.parent("#game-container");
  canvasEl = document.querySelector("#game-container canvas");
  if (pixelFont) textFont(pixelFont);
  resetGame();
}

function startCamera() {
  video = createCapture(VIDEO, function () {
    bodyPose = ml5.bodyPose("MoveNet", { flipped: true }, function () {
      bodyPose.detectStart(video, gotPoses);
    });
    gameState = "positioning";
  });
  video.size(VIDEO_W, VIDEO_H);
  video.hide();
}

function gotPoses(results) {
  poses = results;
}

// --- Keypoint helpers ---

function getNoseY() {
  if (poses.length === 0) return null;
  const kp = poses[0].keypoints;
  if (!kp || kp.length === 0) return null;
  const nose = kp[0];
  if (!nose || nose.confidence < 0.15) return null;
  return nose.y;
}

function getNoseXY() {
  if (poses.length === 0) return null;
  const kp = poses[0].keypoints;
  if (!kp || kp.length === 0) return null;
  const nose = kp[0];
  if (!nose || nose.confidence < 0.15) return null;
  return { x: nose.x, y: nose.y };
}

function hasBody() {
  return getNoseY() !== null;
}

// --- Sliding window velocity ---

// Returns how fast nose moved in the last WINDOW_MS (px per 100ms)
// Negative = fast upward, positive = fast downward, near zero = slow/still
const MIN_DISPLACEMENT = 8;       // general jitter floor
const JUMP_MIN_DISPLACEMENT = 15;  // jump needs more travel than a nod (~15px at 240p)

function getMotion() {
  if (poseHistory.length < 3) return { speed: 0, displacement: 0 };
  const now = millis();
  const cutoff = now - WINDOW_MS;

  let oldest = null;
  for (let i = 0; i < poseHistory.length; i++) {
    if (poseHistory[i].t >= cutoff) {
      oldest = poseHistory[i];
      break;
    }
  }
  if (!oldest) return { speed: 0, displacement: 0 };

  const newest = poseHistory[poseHistory.length - 1];
  const dt = newest.t - oldest.t;
  if (dt < 20) return { speed: 0, displacement: 0 };

  const displacement = newest.y - oldest.y;

  if (Math.abs(displacement) < MIN_DISPLACEMENT) return { speed: 0, displacement: 0 };

  return { speed: (displacement / dt) * 100, displacement: displacement };
}

// --- Main detection logic ---

function updatePoseControls() {
  const ny = getNoseY();
  if (ny === null) return;

  const now = millis();

  // Add to sliding window and prune old entries
  poseHistory.push({ t: now, y: ny });
  while (poseHistory.length > 0 && poseHistory[0].t < now - WINDOW_MS * 3) {
    poseHistory.shift();
  }

  if (gameState !== "playing") return;

  const { speed: spd, displacement } = getMotion();

  if (!cooldown) {
    // Jump needs fast upward speed AND enough distance (filters out nods)
    if (spd < JUMP_THRESHOLD && displacement < -JUMP_MIN_DISPLACEMENT && frog.y === GROUND_Y) {
      // Cancel any pending duck (it was a pre-jump crouch, not a real duck)
      if (duckPendingTimer) {
        clearTimeout(duckPendingTimer);
        duckPendingTimer = null;
        duckPending = false;
      }
      frog.vy = JUMP_IMPULSE;
      bodyState = "jumping";
      cooldown = true;
      setTimeout(function () {
        cooldown = false;
        bodyState = "neutral";
      }, JUMP_COOLDOWN_MS);
    } else if (spd > DUCK_THRESHOLD && frog.y === GROUND_Y && !duckPending) {
      // Don't duck immediately. Wait DUCK_CONFIRM_MS to see if it's a pre-jump crouch.
      duckPending = true;
      duckPendingTimer = setTimeout(function () {
        duckPending = false;
        duckPendingTimer = null;
        // If still not in cooldown (no jump happened), commit to duck
        if (!cooldown) {
          bodyState = "ducking";
          cooldown = true;
          setTimeout(function () {
            bodyState = "neutral";
            setTimeout(function () {
              cooldown = false;
            }, DUCK_RECOVERY_MS);
          }, DUCK_DURATION_MS);
        }
      }, DUCK_CONFIRM_MS);
    }
  }

  frog.ducking = bodyState === "ducking" && frog.y === GROUND_Y;
}

function resetGame() {
  frog = {
    x: 70,
    y: GROUND_Y,
    vy: 0,
    ducking: false,
  };
  obstacles = [];
  snakes = [];
  score = 0;
  speed = BASE_SPEED;
  gameOver = false;
  gamePaused = false;
  spawnTimer = 2500;
  bgOffset = 0;
  groundOffset = 0;
}

// =====================
//     DRAWING
// =====================

function draw() {
  background(12, 20, 18);

  if (gameState === "start") {
    drawStartScreen();
    return;
  }

  if (gameState === "positioning") {
    drawPositioningScreen();
    return;
  }

  drawBackground();
  drawGround();

  updatePoseControls();

  if (gameState === "playing" && !gameOver && !gamePaused) {
    updateFrog();
    updateObstacles();
    updateSnakes();
    updateScore();
    checkCollisions();
  }

  drawFrog();
  drawObstacles();
  drawSnakes();
  drawHud();
  drawCamPip();

  if (gameOver) {
    drawGameOver();
  } else if (gamePaused) {
    drawPaused();
  }
}

// --- Start screen ---
function drawStartScreen() {
  drawBackground();
  drawGround();

  fill(0, 0, 0, 180);
  noStroke();
  rect(0, 0, CANVAS_W, CANVAS_H);

  fill(232, 245, 244);
  stroke(12, 20, 18);
  strokeWeight(3);
  textAlign(CENTER, CENTER);
  textSize(28);
  text("FROG HOP", CANVAS_W / 2, 70);

  noStroke();
  if (frogRunImg) {
    image(frogRunImg, CANVAS_W / 2 - 45, 95, 90, 70);
  }

  const btnW = 220;
  const btnH = 40;
  const btnX = CANVAS_W / 2 - btnW / 2;
  const btnY = 185;
  const mx = gameMouseX();
  const my = gameMouseY();
  startButtonHover = mx > btnX && mx < btnX + btnW && my > btnY && my < btnY + btnH;

  fill(startButtonHover ? color(120, 240, 160) : color(100, 220, 140));
  noStroke();
  rect(btnX, btnY, btnW, btnH, 6);

  fill(12, 20, 18);
  textSize(11);
  textAlign(CENTER, CENTER);
  text("ENABLE CAMERA", btnX + btnW / 2, btnY + btnH / 2);

  fill(232, 245, 244, 120);
  textSize(7);
  text("Jump and duck IRL to control the frog", CANVAS_W / 2, 245);
  text("Keyboard also works (Space / Arrow keys)", CANVAS_W / 2, 262);
}

// --- Positioning screen ---
function drawPositioningScreen() {
  fill(12, 20, 18);
  noStroke();
  rect(0, 0, CANVAS_W, CANVAS_H);

  const prevW = 280;
  const prevH = 210;
  const prevX = CANVAS_W / 2 - prevW / 2;
  const prevY = 20;

  stroke(232, 245, 244, 60);
  strokeWeight(2);
  noFill();
  rect(prevX - 1, prevY - 1, prevW + 2, prevH + 2, 6);
  noStroke();

  if (video) {
    push();
    translate(prevX + prevW, prevY);
    scale(-1, 1);
    image(video, 0, 0, prevW, prevH);
    pop();
  }

  const nose = getNoseXY();
  const detected = nose !== null;

  if (detected) {
    const dotX = prevX + (nose.x / VIDEO_W) * prevW;
    const dotY = prevY + (nose.y / VIDEO_H) * prevH;

    stroke(100, 220, 140, 180);
    strokeWeight(1);
    line(dotX - 12, dotY, dotX + 12, dotY);
    line(dotX, dotY - 12, dotX, dotY + 12);
    noStroke();

    fill(100, 220, 140);
    ellipse(dotX, dotY, 8, 8);
  }

  fill(255, 60, 60);
  noStroke();
  ellipse(prevX + 12, prevY + 12, 7, 7);
  fill(232, 245, 244, 180);
  textSize(7);
  textAlign(LEFT, CENTER);
  text("LIVE", prevX + 19, prevY + 12);

  textAlign(CENTER, CENTER);
  const statusY = prevY + prevH + 18;

  if (!detected) {
    fill(255, 200, 80);
    textSize(9);
    text("Move so the camera can see your face", CANVAS_W / 2, statusY);

    const dots = ".".repeat((floor(frameCount / 20) % 3) + 1);
    fill(255, 200, 80, 120);
    textSize(8);
    text("Searching" + dots, CANVAS_W / 2, statusY + 18);
  } else {
    fill(100, 220, 140);
    textSize(9);
    text("Found you!", CANVAS_W / 2, statusY);

    const btnW = 160;
    const btnH = 32;
    const btnX = CANVAS_W / 2 - btnW / 2;
    const btnY = statusY + 14;
    const mx = gameMouseX();
    const my = gameMouseY();
    readyButtonHover = mx > btnX && mx < btnX + btnW && my > btnY && my < btnY + btnH;

    fill(readyButtonHover ? color(120, 240, 160) : color(100, 220, 140));
    noStroke();
    rect(btnX, btnY, btnW, btnH, 5);

    fill(12, 20, 18);
    textSize(10);
    text("READY", btnX + btnW / 2, btnY + btnH / 2);
  }
}

// --- Camera PIP during gameplay ---
function drawCamPip() {
  if (!video) return;

  const x = CANVAS_W - CAM_W - CAM_MARGIN;
  const y = CAM_MARGIN;

  stroke(232, 245, 244, 50);
  strokeWeight(1);
  noFill();
  rect(x - 1, y - 1, CAM_W + 2, CAM_H + 2, 3);
  noStroke();

  push();
  translate(x + CAM_W, y);
  scale(-1, 1);
  image(video, 0, 0, CAM_W, CAM_H);
  pop();

  const nose = getNoseXY();
  if (nose) {
    const dotX = x + (nose.x / VIDEO_W) * CAM_W;
    const dotY = y + (nose.y / VIDEO_H) * CAM_H;
    fill(100, 220, 140);
    noStroke();
    ellipse(dotX, dotY, 5, 5);
  }

  // State indicator
  let stateColor;
  if (bodyState === "jumping") stateColor = color(255, 200, 80);
  else if (bodyState === "ducking") stateColor = color(80, 160, 255);
  else stateColor = color(100, 220, 140);

  fill(stateColor);
  noStroke();
  ellipse(x + 8, y + 8, 6, 6);
  fill(232, 245, 244, 150);
  textSize(6);
  textAlign(LEFT, CENTER);
  text(bodyState.toUpperCase(), x + 14, y + 8);
}

// --- Game drawing ---

function drawBackground() {
  if (!jungleImg) return;
  const sc = CANVAS_H / jungleImg.height;
  const scaledW = jungleImg.width * sc;
  const x = -(bgOffset % scaledW);
  image(jungleImg, x, 0, scaledW, CANVAS_H);
  image(jungleImg, x + scaledW, 0, scaledW, CANVAS_H);
  if (gameState === "playing" && !gameOver && !gamePaused) {
    bgOffset += speed * 0.3;
  }
}

function drawGround() {
  if (groundImg) {
    const groundH = CANVAS_H - GROUND_Y;
    const tileW = groundImg.width * (groundH / groundImg.height);
    const tx = -(groundOffset % tileW);
    const numTiles = ceil((CANVAS_W + tileW * 2) / tileW);
    for (let i = -1; i <= numTiles; i++) {
      image(groundImg, tx + i * tileW, GROUND_Y, tileW, groundH);
    }
    if (gameState === "playing" && !gameOver && !gamePaused) {
      groundOffset += speed;
    }
  }
}

function updateFrog() {
  const wantsDuck = keyIsDown(DOWN_ARROW);
  if (wantsDuck && frog.y === GROUND_Y) {
    frog.ducking = true;
  }

  frog.vy += GRAVITY;
  frog.y += frog.vy;

  if (frog.y >= GROUND_Y) {
    frog.y = GROUND_Y;
    frog.vy = 0;
  }
}

function drawFrog() {
  if (gameState !== "playing") return;

  const isJumping = frog.y < GROUND_Y - 0.5;
  const runOffset = (floor(frameCount / 8) % 2) * 2;
  const size = getFrogSize();
  const drawX = frog.x + (frog.ducking ? 2 : 0) + runOffset;
  const drawY = frog.y - size.h + (frog.ducking ? 4 : 0) + runOffset;

  if (isJumping) {
    image(frogJumpImg, drawX * 0.7, drawY, FROG_W * 1.2, FROG_H * 1.2);
    return;
  }
  if (frog.ducking) {
    image(frogDuckImg, drawX, drawY, FROG_W, FROG_DUCK_H);
    return;
  }
  image(frogRunImg, drawX, drawY, FROG_W, FROG_H);
}

function getFrogSize() {
  if (frog.ducking) {
    return { w: FROG_W, h: FROG_DUCK_H };
  }
  return { w: FROG_W, h: FROG_H };
}

function updateObstacles() {
  spawnTimer -= deltaTime;
  if (spawnTimer <= 0) {
    if (score >= SNAKE_SCORE_THRESHOLD && random() < 0.5) {
      spawnSnake();
    } else {
      spawnObstacle();
    }
    spawnTimer = random(SNAKE_SPAWN_DELAY_MIN, SNAKE_SPAWN_DELAY_MAX);
  }

  speed = BASE_SPEED + score / 200;
  obstacles.forEach((obstacle) => {
    obstacle.x -= speed;
  });
  obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.w > 0);
}

function spawnObstacle() {
  const type = random() < 0.5 ? "log" : "rock";
  const w = type === "rock" ? ROCK_W : LOG_W;
  const h = type === "rock" ? ROCK_H : LOG_H;
  obstacles.push({
    x: CANVAS_W + max(LOG_W, ROCK_W),
    y: GROUND_Y - h,
    w,
    h,
    type,
  });
}

function drawObstacles() {
  if (gameState !== "playing") return;
  obstacles.forEach((obstacle) => {
    const img = obstacle.type === "rock" ? rockImg : logImg;
    if (img) {
      image(img, obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    } else {
      fill(40, 64, 60);
      rect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 3);
    }
  });
}

function updateSnakes() {
  if (score < SNAKE_SCORE_THRESHOLD) return;
  snakes.forEach((snake) => {
    snake.x -= speed;
  });
  snakes = snakes.filter((snake) => snake.x + snake.w > 0);
}

function spawnSnake() {
  snakes.push({
    x: CANVAS_W + SNAKE_W,
    y: getSnakeSpawnY(),
    w: SNAKE_W,
    h: SNAKE_H,
  });
}

function drawSnakes() {
  if (gameState !== "playing") return;
  if (!snakeImg) return;
  snakes.forEach((snake) => {
    image(snakeImg, snake.x, snake.y, snake.w, snake.h);
  });
}

function updateScore() {
  score += deltaTime * 0.02;
  if (score > highScore) highScore = score;
}

function drawHud() {
  if (gameState !== "playing") return;
  stroke(12, 20, 18);
  strokeWeight(3);
  fill(232, 245, 244);
  textSize(14);
  textAlign(LEFT, TOP);
  text("Score: " + floor(score), 12, 10);
  text("High: " + floor(highScore), 12, 28);
  noStroke();
}

function drawGameOver() {
  stroke(12, 20, 18);
  strokeWeight(3);
  fill(232, 245, 244);
  textAlign(CENTER, CENTER);
  textSize(22);
  text("GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 8);
  textSize(14);
  text("Press Space to Restart", CANVAS_W / 2, CANVAS_H / 2 + 16);
  noStroke();
}

function drawPaused() {
  stroke(12, 20, 18);
  strokeWeight(3);
  fill(232, 245, 244);
  textAlign(CENTER, CENTER);
  textSize(22);
  text("PAUSED", CANVAS_W / 2, CANVAS_H / 2 - 8);
  textSize(14);
  text("Press P to Resume", CANVAS_W / 2, CANVAS_H / 2 + 16);
  noStroke();
}

function checkCollisions() {
  const frogBox = {
    x: frog.x + FROG_HITBOX_INSET_X,
    y: frog.y - FROG_HITBOX_H,
    w: FROG_HITBOX_W,
    h: FROG_HITBOX_H,
  };
  for (const obstacle of obstacles) {
    const hw = obstacle.type === "rock" ? ROCK_HITBOX_W : LOG_HITBOX_W;
    const hh = obstacle.type === "rock" ? ROCK_HITBOX_H : LOG_HITBOX_H;
    const obstacleBox = {
      x: obstacle.x + (obstacle.w - hw) / 2,
      y: obstacle.y + obstacle.h - hh,
      w: hw,
      h: hh,
    };
    if (rectOverlap(frogBox, obstacleBox)) {
      gameOver = true;
      return;
    }
  }
  const frogSize = getFrogSize();
  const frogBoxSnake = {
    x: frog.x + FROG_HITBOX_INSET_X,
    y: frog.y - frogSize.h,
    w: FROG_HITBOX_W,
    h: frogSize.h,
  };
  for (const snake of snakes) {
    const snakeBox = {
      x: snake.x + (snake.w - SNAKE_HITBOX_W) / 2,
      y: snake.y + SNAKE_HITBOX_INSET_TOP,
      w: SNAKE_HITBOX_W,
      h: SNAKE_HITBOX_H,
    };
    if (rectOverlap(frogBoxSnake, snakeBox)) {
      gameOver = true;
      return;
    }
  }
}

function rectOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function getSnakeSpawnY() {
  return GROUND_Y - FROG_H + SNAKE_CLEARANCE - SNAKE_H;
}

// --- Input ---

function mousePressed() {
  if (gameState === "start" && startButtonHover) {
    startCamera();
    return false;
  }
  if (gameState === "positioning" && readyButtonHover && hasBody()) {
    gameState = "playing";
    poseHistory = [];
    return false;
  }
  return true;
}

function keyPressed() {
  const isJumpKey = key === " " || keyCode === UP_ARROW;

  if (key === "p" || key === "P") {
    if (gameState !== "playing" || gameOver) return true;
    gamePaused = !gamePaused;
    return false;
  }
  if (gameOver && isJumpKey) {
    resetGame();
    return false;
  }
  if (gameState !== "playing" || gamePaused) return false;
  if (isJumpKey && frog.y === GROUND_Y) {
    frog.vy = JUMP_IMPULSE;
    return false;
  }
  return true;
}

// --- Touch controls for mobile ---
let touchStartY = null;
const SWIPE_DOWN_THRESHOLD = 30;

function touchStarted() {
  if (gameState === "start") {
    startCamera();
    return false;
  }
  if (gameState === "positioning" && hasBody()) {
    gameState = "playing";
    poseHistory = [];
    return false;
  }
  if (gameOver) {
    resetGame();
    return false;
  }

  // Record touch start for swipe detection
  if (touches.length > 0) {
    touchStartY = touches[0].y;
  }

  // Tap to jump (if not swiping)
  if (gameState === "playing" && !gamePaused && frog.y === GROUND_Y) {
    frog.vy = JUMP_IMPULSE;
  }
  return false;
}

function touchMoved() {
  if (gameState !== "playing" || gamePaused) return false;
  // Detect swipe down for duck
  if (touches.length > 0 && touchStartY !== null) {
    const dy = touches[0].y - touchStartY;
    if (dy > SWIPE_DOWN_THRESHOLD && frog.y === GROUND_Y) {
      frog.ducking = true;
    }
  }
  return false;
}

function touchEnded() {
  frog.ducking = false;
  touchStartY = null;
  return false;
}
