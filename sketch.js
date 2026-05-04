const CANVAS_W = 700;
const CANVAS_H = 400;
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
let restartButtonHover = false;
let nameSubmitButtonHover = false;
let nameFieldHover = false;
let skipLinkHover = false;
let postedNameHover = false;

// --- Leaderboard / persistence ---
const LS_USERNAME_KEY = "froghop_username";
const LS_HIGH_SCORE_KEY = "froghop_high_score";
const NAME_MAX_LEN = 12;

let sessionId = null;
let sessionStartFailed = false;
let username = null;
let pendingName = "";
let nameInputEl = null;
let nameInputActive = false;
let submissionState = "idle"; // idle | pending | success | error
let submissionError = null;
let submittedScoreValue = null;
let postedAsName = null; // username at time of successful submission (frozen for display)
let leaderboard = [];
let leaderboardLoading = false;
let leaderboardError = false;
let gameOverHandled = false;
let gameOverPhase = "results"; // "name_entry" | "results"
let nameEntryReason = "initial"; // "initial" | "change"
let userRank = null; // server-reported rank for current username, or null

// Animation
let gameOverStartedAt = 0;
const SCORE_COUNTUP_MS = 700;
const NEW_HIGH_FLASH_MS = 1500;
let confettiParticles = [];
let confettiSpawned = false;

// p5 handles CSS scaling internally - mouseX/mouseY are already in canvas buffer space
let canvasEl = null;
function gameMouseX() { return mouseX; }
function gameMouseY() { return mouseY; }

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
  hydrateFromLocalStorage();
  ensureNameInputEl();
  fetchLeaderboard();
  resetGame();
}

function hydrateFromLocalStorage() {
  try {
    const storedName = localStorage.getItem(LS_USERNAME_KEY);
    if (storedName) username = sanitizeName(storedName);
    const storedHigh = parseInt(localStorage.getItem(LS_HIGH_SCORE_KEY) || "0", 10);
    if (Number.isFinite(storedHigh) && storedHigh > 0) highScore = storedHigh;
  } catch (e) {
    // localStorage unavailable (private mode etc) - silently continue
  }
}

function persistHighScore() {
  try {
    localStorage.setItem(LS_HIGH_SCORE_KEY, String(Math.floor(highScore)));
  } catch (e) {}
}

function persistUsername(name) {
  try {
    localStorage.setItem(LS_USERNAME_KEY, name);
  } catch (e) {}
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x1f]/g, "").trim().slice(0, NAME_MAX_LEN);
}

// Hidden DOM input captures keystrokes (also triggers mobile keyboard on tap)
function ensureNameInputEl() {
  if (nameInputEl) return;
  nameInputEl = document.createElement("input");
  nameInputEl.type = "text";
  nameInputEl.maxLength = NAME_MAX_LEN;
  nameInputEl.autocomplete = "off";
  nameInputEl.autocapitalize = "characters";
  nameInputEl.spellcheck = false;
  nameInputEl.setAttribute("aria-label", "Your name");
  nameInputEl.style.cssText = "position:fixed;left:50%;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0;font-size:16px;";
  nameInputEl.addEventListener("input", () => {
    pendingName = sanitizeName(nameInputEl.value);
  });
  nameInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNameAndScore();
    } else if (e.key === "Escape") {
      e.preventDefault();
      blurNameInput();
      if (gameOverPhase === "name_entry") {
        if (nameEntryReason === "change") {
          gameOverPhase = "results";
        } else {
          skipNameEntry();
        }
      }
    }
  });
  nameInputEl.addEventListener("blur", () => {
    nameInputActive = false;
  });
  document.body.appendChild(nameInputEl);
}

function focusNameInput() {
  if (!nameInputEl) return;
  nameInputActive = true;
  nameInputEl.value = pendingName;
  nameInputEl.focus();
}

function blurNameInput() {
  if (!nameInputEl) return;
  nameInputActive = false;
  nameInputEl.blur();
}

// --- Network ---

async function startSession() {
  sessionId = null;
  sessionStartFailed = false;
  try {
    const res = await fetch("/api/start", { method: "POST" });
    if (!res.ok) throw new Error("start_failed");
    const data = await res.json();
    sessionId = data.sessionId;
  } catch (e) {
    sessionStartFailed = true;
  }
}

async function submitScore(name, finalScore) {
  if (!sessionId) {
    submissionState = "error";
    submissionError = "no_session";
    return;
  }
  submissionState = "pending";
  submissionError = null;
  try {
    const res = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, score: finalScore, username: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      submissionState = "error";
      submissionError = data.error || "submit_failed";
      return;
    }
    submissionState = "success";
    submittedScoreValue = data.score ?? finalScore;
    postedAsName = name;
    sessionId = null; // session is now spent
    fetchLeaderboard();
  } catch (e) {
    submissionState = "error";
    submissionError = "network_error";
  }
}

async function fetchLeaderboard() {
  leaderboardLoading = true;
  leaderboardError = false;
  try {
    const url = username
      ? "/api/leaderboard?username=" + encodeURIComponent(username)
      : "/api/leaderboard";
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch_failed");
    const data = await res.json();
    leaderboard = Array.isArray(data.entries) ? data.entries : [];
    userRank = typeof data.userRank === "number" ? data.userRank : null;
  } catch (e) {
    leaderboardError = true;
  } finally {
    leaderboardLoading = false;
  }
}

function submitNameAndScore() {
  const clean = sanitizeName(pendingName);
  if (clean.length === 0) return;
  username = clean;
  persistUsername(clean);
  pendingName = clean;
  blurNameInput();
  gameOverPhase = "results";
  if (nameEntryReason === "initial" && sessionId) {
    submitScore(clean, Math.floor(score));
  }
  // For "change" mode (or initial after session is spent), nothing to submit.
  // username + localStorage are already updated; takes effect next round.
}

function skipNameEntry() {
  blurNameInput();
  gameOverPhase = "results";
  // Mark as a "skipped" state so results panel shows a "didn't post" hint
  if (nameEntryReason === "initial") {
    submissionState = "skipped";
  }
}

function openChangeNameUI() {
  nameEntryReason = "change";
  gameOverPhase = "name_entry";
  pendingName = username || "";
  setTimeout(() => {
    if (gameOver && gameOverPhase === "name_entry" && !isLikelyTouchDevice()) {
      focusNameInput();
    }
  }, 50);
}

function handleGameOver() {
  if (gameOverHandled) return;
  gameOverHandled = true;
  gameOverStartedAt = millis();
  if (highScore > 0) persistHighScore();
  if (sessionStartFailed) {
    gameOverPhase = "results";
    submissionState = "error";
    submissionError = "no_session";
    return;
  }
  if (username) {
    pendingName = username;
    gameOverPhase = "results";
    submitScore(username, Math.floor(score));
  } else {
    gameOverPhase = "name_entry";
    nameEntryReason = "initial";
    pendingName = "";
    // Auto-focus on desktop. On mobile we wait for explicit tap so the
    // soft keyboard doesn't pop without user intent.
    setTimeout(() => {
      if (gameOver && gameOverPhase === "name_entry" && !isLikelyTouchDevice()) {
        focusNameInput();
      }
    }, 250);
  }
}

function isLikelyTouchDevice() {
  return typeof window !== "undefined" &&
    (("ontouchstart" in window) || (navigator && navigator.maxTouchPoints > 0));
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
  gameOverHandled = false;
  submissionState = "idle";
  submissionError = null;
  submittedScoreValue = null;
  postedAsName = null;
  gameOverPhase = "results";
  nameEntryReason = "initial";
  userRank = null;
  gameOverStartedAt = 0;
  confettiParticles = [];
  confettiSpawned = false;
  if (gameState === "playing") startSession();
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

  if (gameOver && !gameOverHandled) handleGameOver();
  if (gameOver) updateGameOverHover();

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
  if (gameOver) return; // game-over overlay uses this corner for the leaderboard

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

// --- Game over layout constants ---
const GO_PAD_X = 40;
const GO_LEFT_X = GO_PAD_X;
const GO_LEFT_W = 280;
const GO_RIGHT_X = 360;
const GO_RIGHT_W = CANVAS_W - GO_RIGHT_X - GO_PAD_X;
const GO_TITLE_Y = 38;
const GO_SCORE_LABEL_Y = 78;
const GO_SCORE_VALUE_Y = 108;
const GO_HIGH_LABEL_Y = 145;
const GO_HIGH_VALUE_Y = 165;
const GO_NAME_LABEL_Y = 200;
const NAME_BOX_X = GO_LEFT_X + 10;
const NAME_BOX_Y = 215;
const NAME_BOX_W = GO_LEFT_W - 20;
const NAME_BOX_H = 32;
const SUBMIT_BTN_W = 120;
const SUBMIT_BTN_H = 30;
const SUBMIT_BTN_X = GO_LEFT_X + (GO_LEFT_W - SUBMIT_BTN_W) / 2;
const SUBMIT_BTN_Y = 257;
const LB_TITLE_Y = 78;
const LB_FIRST_ROW_Y = 102;
const LB_ROW_H = 18;
const LB_MAX_ROWS = 10;
const RESTART_BTN_W = 220;
const RESTART_BTN_H = 28;
const RESTART_BTN_X = (CANVAS_W - RESTART_BTN_W) / 2;
const RESTART_BTN_Y = CANVAS_H - 40;

// --- Name-entry phase layout (centered focus card) ---
const NEC_TITLE_Y = 85;
const NEC_SCORE_LINE_Y = 125;
const NEC_LABEL_Y = 180;
const NEC_FIELD_W = 280;
const NEC_FIELD_X = (CANVAS_W - NEC_FIELD_W) / 2;
const NEC_FIELD_Y = 198;
const NEC_FIELD_H = 40;
const NEC_BUTTON_W = 160;
const NEC_BUTTON_X = (CANVAS_W - NEC_BUTTON_W) / 2;
const NEC_BUTTON_Y = 262;
const NEC_BUTTON_H = 36;
const NEC_SKIP_Y = 322;
const NEC_SKIP_HIT_W = 120;
const NEC_SKIP_HIT_H = 22;
const NEC_SKIP_HIT_X = (CANVAS_W - NEC_SKIP_HIT_W) / 2;
const NEC_SKIP_HIT_Y = NEC_SKIP_Y - NEC_SKIP_HIT_H / 2;

const POSTED_NAME_HIT_X = GO_LEFT_X;
const POSTED_NAME_HIT_Y = 215;
const POSTED_NAME_HIT_W = GO_LEFT_W;
const POSTED_NAME_HIT_H = 30;

function drawGameOver() {
  // Dim the play field so the panel is legible
  noStroke();
  fill(0, 0, 0, 200);
  rect(0, 0, CANVAS_W, CANVAS_H);

  if (gameOverPhase === "name_entry") {
    drawNameEntryPhase();
  } else {
    drawResultsPhase();
  }
  updateAndDrawConfetti();
}

function drawResultsPhase() {
  // Title
  stroke(12, 20, 18);
  strokeWeight(3);
  fill(232, 245, 244);
  textAlign(CENTER, CENTER);
  textSize(20);
  text("GAME OVER", CANVAS_W / 2, GO_TITLE_Y);
  noStroke();

  drawScorePanel();
  drawLeaderboardPanel();
  drawRestartButton();
}

function drawNameEntryPhase() {
  const isChange = nameEntryReason === "change";
  const finalScore = Math.floor(score);

  // Title
  stroke(12, 20, 18);
  strokeWeight(3);
  fill(232, 245, 244);
  textAlign(CENTER, CENTER);
  textSize(20);
  text(isChange ? "CHANGE NAME" : "GAME OVER", CANVAS_W / 2, NEC_TITLE_Y);
  noStroke();

  // Subtitle / score line
  fill(232, 245, 244, 160);
  textSize(8);
  if (isChange) {
    text("USED ON YOUR NEXT GAME", CANVAS_W / 2, NEC_SCORE_LINE_Y);
  } else {
    text("YOUR SCORE", CANVAS_W / 2, NEC_SCORE_LINE_Y - 14);
    fill(232, 245, 244);
    textSize(20);
    text(String(finalScore), CANVAS_W / 2, NEC_SCORE_LINE_Y + 8);
  }

  // Label above field
  fill(232, 245, 244, 180);
  textSize(9);
  text(isChange ? "NEW NAME" : "ENTER NAME FOR LEADERBOARD", CANVAS_W / 2, NEC_LABEL_Y);

  drawCenterNameField();
  drawCenterSubmitButton(isChange ? "SAVE" : "SUBMIT");

  // Skip / cancel link
  const linkLabel = isChange ? "CANCEL" : "SKIP";
  fill(232, 245, 244, skipLinkHover ? 220 : 130);
  textSize(8);
  textAlign(CENTER, CENTER);
  text(linkLabel, CANVAS_W / 2, NEC_SKIP_Y);
  // Underline on hover
  if (skipLinkHover) {
    const w = textWidth(linkLabel);
    stroke(232, 245, 244, 180);
    strokeWeight(1);
    line(CANVAS_W / 2 - w / 2, NEC_SKIP_Y + 7, CANVAS_W / 2 + w / 2, NEC_SKIP_Y + 7);
    noStroke();
  }
}

function drawCenterNameField() {
  const focused = nameInputActive;
  const display = pendingName || "";

  noStroke();
  fill(focused ? color(20, 32, 28, 230) : color(20, 32, 28, 180));
  rect(NEC_FIELD_X, NEC_FIELD_Y, NEC_FIELD_W, NEC_FIELD_H, 4);

  noFill();
  stroke(focused ? color(120, 240, 160) : color(232, 245, 244, nameFieldHover ? 160 : 90));
  strokeWeight(focused ? 2 : 1);
  rect(NEC_FIELD_X, NEC_FIELD_Y, NEC_FIELD_W, NEC_FIELD_H, 4);
  noStroke();

  textSize(13);
  if (display.length === 0 && !focused) {
    fill(232, 245, 244, 80);
    textAlign(CENTER, CENTER);
    text("YOUR NAME", NEC_FIELD_X + NEC_FIELD_W / 2, NEC_FIELD_Y + NEC_FIELD_H / 2);
  } else {
    fill(232, 245, 244);
    textAlign(CENTER, CENTER);
    text(display, NEC_FIELD_X + NEC_FIELD_W / 2, NEC_FIELD_Y + NEC_FIELD_H / 2);
    if (focused && floor(frameCount / 30) % 2 === 0) {
      const w = textWidth(display);
      const cx = NEC_FIELD_X + NEC_FIELD_W / 2 + w / 2 + 3;
      stroke(232, 245, 244);
      strokeWeight(1);
      line(cx, NEC_FIELD_Y + 10, cx, NEC_FIELD_Y + NEC_FIELD_H - 10);
      noStroke();
    }
  }
}

function drawCenterSubmitButton(label) {
  const enabled = sanitizeName(pendingName).length > 0;
  noStroke();
  if (enabled) {
    fill(nameSubmitButtonHover ? color(120, 240, 160) : color(100, 220, 140));
  } else {
    fill(60, 80, 70);
  }
  rect(NEC_BUTTON_X, NEC_BUTTON_Y, NEC_BUTTON_W, NEC_BUTTON_H, 5);

  fill(enabled ? color(12, 20, 18) : color(232, 245, 244, 90));
  textSize(11);
  textAlign(CENTER, CENTER);
  text(label, NEC_BUTTON_X + NEC_BUTTON_W / 2, NEC_BUTTON_Y + NEC_BUTTON_H / 2);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function getAnimatedScore(finalScore) {
  if (!gameOverStartedAt) return finalScore;
  const t = constrain((millis() - gameOverStartedAt) / SCORE_COUNTUP_MS, 0, 1);
  return Math.floor(finalScore * easeOutCubic(t));
}

function drawScorePanel() {
  const finalScore = Math.floor(score);
  const finalHigh = Math.floor(highScore);
  const isNewHigh = finalScore > 0 && finalScore >= finalHigh;
  const animScore = getAnimatedScore(finalScore);

  // SCORE label + value
  fill(232, 245, 244, 140);
  textAlign(CENTER, CENTER);
  textSize(8);
  noStroke();
  text("YOUR SCORE", GO_LEFT_X + GO_LEFT_W / 2, GO_SCORE_LABEL_Y);

  // New-best flash: pulse from gold to white over flash duration
  let scoreColor;
  if (isNewHigh) {
    const flashT = constrain((millis() - gameOverStartedAt) / NEW_HIGH_FLASH_MS, 0, 1);
    // Pulse 3 times then settle on gold
    const pulse = flashT < 1 ? 0.5 + 0.5 * Math.sin(flashT * Math.PI * 6) : 1;
    scoreColor = lerpColor(color(232, 245, 244), color(255, 220, 100), pulse);
  } else {
    scoreColor = color(232, 245, 244);
  }
  fill(scoreColor);
  textSize(28);
  text(String(animScore), GO_LEFT_X + GO_LEFT_W / 2, GO_SCORE_VALUE_Y);

  // HIGH score
  fill(232, 245, 244, 140);
  textSize(7);
  text(isNewHigh ? "NEW BEST!" : "BEST", GO_LEFT_X + GO_LEFT_W / 2, GO_HIGH_LABEL_Y);
  fill(232, 245, 244, isNewHigh ? 255 : 200);
  textSize(11);
  text(String(finalHigh), GO_LEFT_X + GO_LEFT_W / 2, GO_HIGH_VALUE_Y);

  // Spawn confetti once when count-up nears completion AND it's a new best
  if (isNewHigh && !confettiSpawned && gameOverStartedAt &&
      millis() - gameOverStartedAt >= SCORE_COUNTUP_MS * 0.6) {
    spawnConfetti(GO_LEFT_X + GO_LEFT_W / 2, GO_SCORE_VALUE_Y);
    confettiSpawned = true;
  }

  // Submission flow
  drawSubmissionUI();
}

function spawnConfetti(x, y) {
  const colors = [
    [255, 220, 100],   // gold
    [100, 220, 140],   // green
    [120, 200, 255],   // sky
    [255, 140, 200],   // pink
    [232, 245, 244],   // white
  ];
  for (let i = 0; i < 36; i++) {
    confettiParticles.push({
      x: x + random(-8, 8),
      y: y + random(-4, 4),
      vx: random(-3.5, 3.5),
      vy: random(-7, -3),
      gravity: random(0.18, 0.28),
      size: random(2.5, 4.5),
      rot: random(TWO_PI),
      vrot: random(-0.2, 0.2),
      color: colors[Math.floor(random(colors.length))],
      life: 1,
      decay: random(0.008, 0.016),
    });
  }
}

function updateAndDrawConfetti() {
  if (confettiParticles.length === 0) return;
  noStroke();
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const p = confettiParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.rot += p.vrot;
    p.life -= p.decay;
    if (p.life <= 0 || p.y > CANVAS_H + 20) {
      confettiParticles.splice(i, 1);
      continue;
    }
    const c = color(p.color[0], p.color[1], p.color[2]);
    c.setAlpha(Math.max(0, p.life * 255));
    fill(c);
    push();
    translate(p.x, p.y);
    rotate(p.rot);
    rect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
    pop();
  }
}

function drawSubmissionUI() {
  textAlign(CENTER, CENTER);
  noStroke();
  const cx = GO_LEFT_X + GO_LEFT_W / 2;

  if (sessionStartFailed && submissionState !== "success") {
    fill(255, 160, 80, 200);
    textSize(7);
    text("OFFLINE: SCORE WON'T POST", cx, GO_NAME_LABEL_Y);
    return;
  }

  if (submissionState === "skipped") {
    fill(232, 245, 244, 130);
    textSize(7);
    text("DIDN'T POST", cx, GO_NAME_LABEL_Y);
    return;
  }

  if (submissionState === "pending") {
    fill(232, 245, 244, 180);
    textSize(8);
    text("POSTING...", cx, GO_NAME_LABEL_Y + 14);
    return;
  }

  if (submissionState === "success") {
    fill(100, 220, 140);
    textSize(8);
    text("POSTED AS", cx, GO_NAME_LABEL_Y);

    // Clickable username
    const display = postedAsName || username || "";
    fill(postedNameHover ? color(120, 240, 160) : color(232, 245, 244));
    textSize(13);
    text(display, cx, GO_NAME_LABEL_Y + 22);
    if (postedNameHover) {
      // Underline + edit hint
      const w = textWidth(display);
      stroke(120, 240, 160, 180);
      strokeWeight(1);
      line(cx - w / 2, GO_NAME_LABEL_Y + 32, cx + w / 2, GO_NAME_LABEL_Y + 32);
      noStroke();
    }
    fill(232, 245, 244, postedNameHover ? 180 : 100);
    textSize(6);
    text("TAP TO CHANGE", cx, GO_NAME_LABEL_Y + 44);
    return;
  }

  if (submissionState === "error") {
    fill(255, 120, 120);
    textSize(7);
    const msg = submissionError === "score_too_high_for_elapsed_time"
      ? "SCORE REJECTED"
      : "SUBMIT FAILED";
    text(msg, cx, GO_NAME_LABEL_Y);
    fill(232, 245, 244, 140);
    textSize(6);
    text("CLICK TO RETRY", cx, GO_NAME_LABEL_Y + 14);
    return;
  }
}

function drawNameField() {
  const focused = nameInputActive;
  const display = pendingName || "";

  // Field background
  noStroke();
  fill(focused ? color(20, 32, 28, 230) : color(20, 32, 28, 180));
  rect(NAME_BOX_X, NAME_BOX_Y, NAME_BOX_W, NAME_BOX_H, 4);

  // Field border
  noFill();
  stroke(focused ? color(120, 240, 160) : color(232, 245, 244, nameFieldHover ? 140 : 80));
  strokeWeight(focused ? 2 : 1);
  rect(NAME_BOX_X, NAME_BOX_Y, NAME_BOX_W, NAME_BOX_H, 4);
  noStroke();

  // Text
  textAlign(LEFT, CENTER);
  textSize(11);
  if (display.length === 0 && !focused) {
    fill(232, 245, 244, 80);
    text("YOUR NAME", NAME_BOX_X + 10, NAME_BOX_Y + NAME_BOX_H / 2);
  } else {
    fill(232, 245, 244);
    text(display, NAME_BOX_X + 10, NAME_BOX_Y + NAME_BOX_H / 2);
    // Blinking cursor when focused
    if (focused && floor(frameCount / 30) % 2 === 0) {
      const w = textWidth(display);
      const cx = NAME_BOX_X + 10 + w + 2;
      stroke(232, 245, 244);
      strokeWeight(1);
      line(cx, NAME_BOX_Y + 8, cx, NAME_BOX_Y + NAME_BOX_H - 8);
      noStroke();
    }
  }
}

function drawSubmitButton() {
  const enabled = sanitizeName(pendingName).length > 0;
  noStroke();
  if (enabled) {
    fill(nameSubmitButtonHover ? color(120, 240, 160) : color(100, 220, 140));
  } else {
    fill(60, 80, 70);
  }
  rect(SUBMIT_BTN_X, SUBMIT_BTN_Y, SUBMIT_BTN_W, SUBMIT_BTN_H, 4);

  fill(enabled ? color(12, 20, 18) : color(232, 245, 244, 80));
  textSize(10);
  textAlign(CENTER, CENTER);
  text("SUBMIT", SUBMIT_BTN_X + SUBMIT_BTN_W / 2, SUBMIT_BTN_Y + SUBMIT_BTN_H / 2);
}

function drawLeaderboardPanel() {
  textAlign(LEFT, CENTER);
  noStroke();

  fill(232, 245, 244, 140);
  textSize(8);
  text("TOP 10", GO_RIGHT_X, LB_TITLE_Y);

  if (leaderboardLoading && leaderboard.length === 0) {
    fill(232, 245, 244, 100);
    textSize(7);
    text("LOADING...", GO_RIGHT_X, LB_FIRST_ROW_Y);
    return;
  }

  if (leaderboardError && leaderboard.length === 0) {
    fill(255, 160, 80, 180);
    textSize(7);
    text("UNAVAILABLE", GO_RIGHT_X, LB_FIRST_ROW_Y);
    return;
  }

  if (leaderboard.length === 0) {
    fill(232, 245, 244, 100);
    textSize(7);
    text("BE THE FIRST", GO_RIGHT_X, LB_FIRST_ROW_Y);
    return;
  }

  textSize(9);
  const rows = leaderboard.slice(0, LB_MAX_ROWS);
  const myNameForCompare = postedAsName || username;
  let foundMineInTop = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = LB_FIRST_ROW_Y + i * LB_ROW_H;
    const isMine = myNameForCompare && row.username === myNameForCompare;
    if (isMine) foundMineInTop = true;
    const alpha = isMine ? 255 : 200;
    fill(isMine ? color(255, 220, 100) : color(232, 245, 244, alpha));
    // Rank
    textAlign(LEFT, CENTER);
    text(String(i + 1).padStart(2, " ") + ".", GO_RIGHT_X, y);
    // Name
    text(row.username, GO_RIGHT_X + 30, y);
    // Score (right-aligned)
    textAlign(RIGHT, CENTER);
    text(String(row.score), GO_RIGHT_X + GO_RIGHT_W, y);
  }

  // Show user rank below if not in top 10
  if (!foundMineInTop && userRank && userRank > LB_MAX_ROWS && submissionState === "success") {
    const y = LB_FIRST_ROW_Y + Math.min(rows.length, LB_MAX_ROWS) * LB_ROW_H + 10;
    // Divider
    stroke(232, 245, 244, 50);
    strokeWeight(1);
    line(GO_RIGHT_X, y - 2, GO_RIGHT_X + GO_RIGHT_W, y - 2);
    noStroke();
    fill(232, 245, 244, 130);
    textSize(7);
    textAlign(LEFT, CENTER);
    text("YOU", GO_RIGHT_X, y + 10);
    fill(255, 220, 100);
    textSize(9);
    text("#" + userRank + "  " + (postedAsName || username || ""), GO_RIGHT_X + 30, y + 10);
    fill(255, 220, 100, 220);
    textAlign(RIGHT, CENTER);
    text(String(submittedScoreValue ?? Math.floor(score)), GO_RIGHT_X + GO_RIGHT_W, y + 10);
  }
}

function drawRestartButton() {
  noStroke();
  fill(restartButtonHover ? color(255, 255, 255, 25) : color(255, 255, 255, 12));
  rect(RESTART_BTN_X, RESTART_BTN_Y - RESTART_BTN_H / 2, RESTART_BTN_W, RESTART_BTN_H, 4);

  fill(232, 245, 244, restartButtonHover ? 255 : 180);
  textSize(8);
  textAlign(CENTER, CENTER);
  text("PRESS SPACE OR TAP TO RESTART", CANVAS_W / 2, RESTART_BTN_Y);
}

function isInRect(mx, my, rx, ry, rw, rh) {
  return mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh;
}

function gameOverHitTest(mx, my) {
  if (gameOverPhase === "name_entry") {
    if (isInRect(mx, my, NEC_FIELD_X, NEC_FIELD_Y, NEC_FIELD_W, NEC_FIELD_H)) return "name";
    if (isInRect(mx, my, NEC_BUTTON_X, NEC_BUTTON_Y, NEC_BUTTON_W, NEC_BUTTON_H)) return "submit";
    if (isInRect(mx, my, NEC_SKIP_HIT_X, NEC_SKIP_HIT_Y, NEC_SKIP_HIT_W, NEC_SKIP_HIT_H)) return "skip";
    return null;
  }
  // Results phase
  if (submissionState === "success" &&
      isInRect(mx, my, POSTED_NAME_HIT_X, POSTED_NAME_HIT_Y, POSTED_NAME_HIT_W, POSTED_NAME_HIT_H)) {
    return "edit_name";
  }
  if (submissionState === "error") {
    if (isInRect(mx, my, GO_LEFT_X, GO_NAME_LABEL_Y - 14, GO_LEFT_W, 50)) return "retry";
  }
  if (isInRect(mx, my, RESTART_BTN_X, RESTART_BTN_Y - RESTART_BTN_H / 2, RESTART_BTN_W, RESTART_BTN_H)) {
    return "restart";
  }
  return null;
}

function handleGameOverClick(mx, my) {
  const hit = gameOverHitTest(mx, my);
  if (hit === "name") {
    focusNameInput();
    return true;
  }
  if (hit === "submit") {
    if (sanitizeName(pendingName).length === 0) {
      focusNameInput();
      return true;
    }
    submitNameAndScore();
    return true;
  }
  if (hit === "skip") {
    if (nameEntryReason === "change") {
      // Cancel: just go back to results without saving
      blurNameInput();
      gameOverPhase = "results";
    } else {
      skipNameEntry();
    }
    return true;
  }
  if (hit === "edit_name") {
    openChangeNameUI();
    return true;
  }
  if (hit === "retry") {
    if (username) submitScore(username, Math.floor(score));
    return true;
  }
  if (hit === "restart") {
    blurNameInput();
    resetGame();
    return true;
  }
  // Tap outside name field while focused = blur
  if (nameInputActive) {
    blurNameInput();
  }
  return false;
}

function updateGameOverHover() {
  const mx = gameMouseX();
  const my = gameMouseY();
  if (gameOverPhase === "name_entry") {
    nameFieldHover = isInRect(mx, my, NEC_FIELD_X, NEC_FIELD_Y, NEC_FIELD_W, NEC_FIELD_H);
    nameSubmitButtonHover = isInRect(mx, my, NEC_BUTTON_X, NEC_BUTTON_Y, NEC_BUTTON_W, NEC_BUTTON_H);
    skipLinkHover = isInRect(mx, my, NEC_SKIP_HIT_X, NEC_SKIP_HIT_Y, NEC_SKIP_HIT_W, NEC_SKIP_HIT_H);
    restartButtonHover = false;
    postedNameHover = false;
  } else {
    restartButtonHover = isInRect(mx, my, RESTART_BTN_X, RESTART_BTN_Y - RESTART_BTN_H / 2, RESTART_BTN_W, RESTART_BTN_H);
    postedNameHover = submissionState === "success" &&
      isInRect(mx, my, POSTED_NAME_HIT_X, POSTED_NAME_HIT_Y, POSTED_NAME_HIT_W, POSTED_NAME_HIT_H);
    nameFieldHover = false;
    nameSubmitButtonHover = false;
    skipLinkHover = false;
  }
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

function handleUserTap() {
  // On start screen, any click/tap enables camera
  if (gameState === "start") {
    startCamera();
    return true;
  }
  // On positioning, any click/tap starts game if body detected
  if (gameState === "positioning" && hasBody()) {
    gameState = "playing";
    poseHistory = [];
    startSession();
    return true;
  }
  // Game over: gameOver UI handles its own clicks (name input, submit, restart)
  return false;
}

function mousePressed() {
  if (handleUserTap()) return false;
  if (gameOver) {
    handleGameOverClick(gameMouseX(), gameMouseY());
    return false;
  }
  // In-game click = jump (fallback if camera not working)
  if (gameState === "playing" && !gamePaused && frog && frog.y === GROUND_Y) {
    frog.vy = JUMP_IMPULSE;
    return false;
  }
  return true;
}

function keyPressed() {
  // Don't intercept any keys while typing in the name input
  if (nameInputActive) return true;

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
  if (handleUserTap()) return false;

  if (gameOver) {
    handleGameOverClick(gameMouseX(), gameMouseY());
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
