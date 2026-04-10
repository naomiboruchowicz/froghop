const CANVAS_W = 700;
const CANVAS_H = 300;
const GROUND_Y = CANVAS_H - CANVAS_H / 5;

const BASE_SPEED = 6;
const GRAVITY = 0.8;
const JUMP_IMPULSE = -12;

const FROG_W = 90;
const FROG_H = 70;
const FROG_DUCK_H = 50;
const FROG_JUMP_H = 30;

const SNAKE_SCORE_THRESHOLD = 150;
const SNAKE_SPAWN_DELAY_MIN = 1400;
const SNAKE_SPAWN_DELAY_MAX = 2200;
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
let calibratedY = null;
let calibrationSamples = [];
const CALIBRATION_DURATION = 90;
const DUCK_THRESHOLD = 28;
const CAM_W = 140;
const CAM_H = 105;
const CAM_MARGIN = 8;
const VIDEO_W = 640;
const VIDEO_H = 480;

let smoothNoseY = null;
let prevSmooth = null;
const SMOOTH_FACTOR = 0.6; // fast response

// Jump: velocity-based detection (how fast nose moves up, not just position)
let lastJumpTime = 0;
const JUMP_COOLDOWN = 800;
const JUMP_VELOCITY = -4; // nose must move up this many px/frame to count as jump (negative = up)

// Duck debounce: sustained crouch required
let duckStartTime = 0;
let isDucking = false;
const DUCK_DELAY = 250;

// --- Game state machine ---
// "start" -> "positioning" -> "calibrating" -> "playing"
let gameState = "start";
let startButtonHover = false;
let readyButtonHover = false;

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
  if (pixelFont) textFont(pixelFont);
  resetGame();
}

function startCamera() {
  video = createCapture(VIDEO, function () {
    console.log("Camera ready, initializing bodyPose...");
    // Init model AFTER camera is ready, with callback when model is loaded
    bodyPose = ml5.bodyPose("MoveNet", { flipped: true }, function () {
      console.log("bodyPose model loaded, starting detection...");
      bodyPose.detectStart(video, gotPoses);
      console.log("detectStart called");
    });
    gameState = "positioning";
  });
  video.size(VIDEO_W, VIDEO_H);
  video.hide();
}

function gotPoses(results) {
  poses = results;
}

function getNoseY() {
  if (poses.length === 0) return null;
  const kp = poses[0].keypoints;
  if (!kp || kp.length === 0) return null;
  const nose = kp[0]; // index 0 is nose in MoveNet
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

function updatePoseControls() {
  const rawNoseY = getNoseY();
  if (rawNoseY === null) return;

  if (smoothNoseY === null) {
    smoothNoseY = rawNoseY;
    prevSmooth = rawNoseY;
  } else {
    prevSmooth = smoothNoseY;
    smoothNoseY = smoothNoseY + SMOOTH_FACTOR * (rawNoseY - smoothNoseY);
  }

  if (gameState === "calibrating") {
    calibrationSamples.push(smoothNoseY);
    if (calibrationSamples.length >= CALIBRATION_DURATION) {
      const sorted = [...calibrationSamples].sort((a, b) => a - b);
      calibratedY = sorted[Math.floor(sorted.length / 2)];
      gameState = "playing";
    }
    return;
  }

  if (gameState !== "playing" || calibratedY === null) return;

  const delta = smoothNoseY - calibratedY;
  const velocity = smoothNoseY - prevSmooth; // negative = moving up
  const now = millis();

  // Velocity-based jump: detect fast upward motion
  // This catches jumps regardless of how far you move, just how fast
  if (velocity < JUMP_VELOCITY && frog.y === GROUND_Y && now - lastJumpTime > JUMP_COOLDOWN) {
    frog.vy = JUMP_IMPULSE;
    lastJumpTime = now;
    // Cancel any duck-in-progress (the crouch was a jump windup, not a duck)
    duckStartTime = 0;
    isDucking = false;
  }

  // Duck: require sustained crouch before triggering
  const wantsDuck = delta > DUCK_THRESHOLD && frog.y === GROUND_Y;

  if (wantsDuck) {
    if (duckStartTime === 0) {
      duckStartTime = now;
    }
    if (now - duckStartTime >= DUCK_DELAY) {
      isDucking = true;
    }
  } else {
    duckStartTime = 0;
    isDucking = false;
  }

  frog.ducking = isDucking;
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
  spawnTimer = 900;
  bgOffset = 0;
  groundOffset = 0;
}

// --- Drawing ---

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

  // calibrating or playing
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

  if (gameState === "calibrating") {
    drawCalibrationOverlay();
  } else if (gameOver) {
    drawGameOver();
  } else if (gamePaused) {
    drawPaused();
  }
}

// --- Screen: Start ---
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
  startButtonHover = mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH;

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

// --- Screen: Positioning ---
function drawPositioningScreen() {
  fill(12, 20, 18);
  noStroke();
  rect(0, 0, CANVAS_W, CANVAS_H);

  const prevW = 280;
  const prevH = 210;
  const prevX = CANVAS_W / 2 - prevW / 2;
  const prevY = 20;

  // Border
  stroke(232, 245, 244, 60);
  strokeWeight(2);
  noFill();
  rect(prevX - 1, prevY - 1, prevW + 2, prevH + 2, 6);
  noStroke();

  // Draw mirrored camera feed
  if (video) {
    push();
    translate(prevX + prevW, prevY);
    scale(-1, 1);
    image(video, 0, 0, prevW, prevH);
    pop();
  }

  const nose = getNoseXY();
  const noseDetected = nose !== null;

  // Draw nose indicator (coordinates are already flipped by ml5)
  if (noseDetected) {
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

  // LIVE dot
  fill(255, 60, 60);
  noStroke();
  ellipse(prevX + 12, prevY + 12, 7, 7);
  fill(232, 245, 244, 180);
  textSize(7);
  textAlign(LEFT, CENTER);
  text("LIVE", prevX + 19, prevY + 12);

  // Status
  textAlign(CENTER, CENTER);
  const statusY = prevY + prevH + 18;

  if (!noseDetected) {
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
    readyButtonHover = mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH;

    fill(readyButtonHover ? color(120, 240, 160) : color(100, 220, 140));
    noStroke();
    rect(btnX, btnY, btnW, btnH, 5);

    fill(12, 20, 18);
    textSize(10);
    text("READY", btnX + btnW / 2, btnY + btnH / 2);
  }
}

// --- Calibration overlay ---
function drawCalibrationOverlay() {
  fill(0, 0, 0, 160);
  noStroke();
  rect(0, 0, CANVAS_W, CANVAS_H);

  const progress = calibrationSamples.length / CALIBRATION_DURATION;

  fill(232, 245, 244);
  stroke(12, 20, 18);
  strokeWeight(3);
  textAlign(CENTER, CENTER);
  textSize(16);
  text("HOLD STILL", CANVAS_W / 2, CANVAS_H / 2 - 24);

  textSize(9);
  noStroke();
  fill(232, 245, 244, 160);
  text("Stand in your normal position", CANVAS_W / 2, CANVAS_H / 2);

  const barW = 160;
  const barH = 8;
  const barX = CANVAS_W / 2 - barW / 2;
  const barY = CANVAS_H / 2 + 18;
  fill(40, 60, 55);
  noStroke();
  rect(barX, barY, barW, barH, 4);
  fill(100, 220, 140);
  rect(barX, barY, barW * progress, barH, 4);
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

  // Draw mirrored camera feed
  push();
  translate(x + CAM_W, y);
  scale(-1, 1);
  image(video, 0, 0, CAM_W, CAM_H);
  pop();

  // Nose dot (coordinates already flipped by ml5)
  const nose = getNoseXY();
  if (nose) {
    const dotX = x + (nose.x / VIDEO_W) * CAM_W;
    const dotY = y + (nose.y / VIDEO_H) * CAM_H;
    fill(100, 220, 140);
    noStroke();
    ellipse(dotX, dotY, 5, 5);

    if (calibratedY !== null) {
      const baselineY = y + (calibratedY / VIDEO_H) * CAM_H;
      stroke(100, 220, 140, 80);
      strokeWeight(1);
      line(x, baselineY, x + CAM_W, baselineY);

      stroke(255, 200, 80, 40);
      const jumpLineY = y + ((calibratedY - JUMP_THRESHOLD) / VIDEO_H) * CAM_H;
      line(x, jumpLineY, x + CAM_W, jumpLineY);

      stroke(80, 160, 255, 40);
      const duckLineY = y + ((calibratedY + DUCK_THRESHOLD) / VIDEO_H) * CAM_H;
      line(x, duckLineY, x + CAM_W, duckLineY);
      noStroke();
    }
  }

  // LIVE indicator
  fill(255, 60, 60);
  noStroke();
  ellipse(x + 8, y + 8, 5, 5);
  fill(232, 245, 244, 150);
  textSize(6);
  textAlign(LEFT, CENTER);
  text("LIVE", x + 13, y + 8);
}

// --- Original game drawing ---

function drawBackground() {
  if (!jungleImg) return;
  const scale = CANVAS_H / jungleImg.height;
  const scaledW = jungleImg.width * scale;
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
  if (gameState !== "playing" && gameState !== "calibrating") return;

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
  if (gameState !== "playing" && gameState !== "calibrating") return;
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
  if (gameState !== "playing" && gameState !== "calibrating") return;
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
  if (gameState === "positioning" && readyButtonHover && getNoseY() !== null) {
    gameState = "calibrating";
    calibrationSamples = [];
    calibratedY = null;
    smoothNoseY = null;
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
  if ((key === "r" || key === "R") && gameState === "playing") {
    gameState = "calibrating";
    calibrationSamples = [];
    calibratedY = null;
    smoothNoseY = null;
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
