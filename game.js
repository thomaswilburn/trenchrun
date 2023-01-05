const MAX_DEPTH = 512;
const XFOV = Math.PI * .3; // 60deg FOV
const YFOV = XFOV * .75 // vertical FOV
const XFOV2 = XFOV * .5;
const YFOV2 = YFOV * .5;
const WIDTH = 640;
const HEIGHT = 480;
const TILE_SIZE = 1024;

// these are precomputed angle steps for going across the viewport,
// both vertically and horizontally
const COL_RATIO = new Float32Array(WIDTH);
const ROW_RATIO = new Float32Array(HEIGHT);
for (var i = 0; i < WIDTH; i++) {
  COL_RATIO[i] = XFOV * (i / WIDTH) - XFOV2;
}
for (var i = 0; i < HEIGHT; i++) {
  ROW_RATIO[i] = YFOV * ((HEIGHT - i) / HEIGHT) - YFOV2;
}

function loadImage(url) {
  var image = new Image();
  image.src = url;
  return new Promise(function(ok, fail) {
    image.onload = e => ok(image);
    image.onerror = fail;
  });
}

async function loadMap(url, size) {
  var image = await loadImage(url);
  var canvas = document.createElement("canvas");
  var w = canvas.width = size || image.naturalWidth;
  var h = canvas.height = size || image.naturalHeight;
  var context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, w, h);
  var { data } = context.getImageData(0, 0, w, h);
  var map = new Uint8Array(w * h);
  for (var i = 0; i < w * h; i++) {
    map[i] = data[i * 4];
  }
  return { map, width: w, height: h };
}

var heightmap = await loadMap("heightmap.jpg", TILE_SIZE);

var camera = {
  x: 128,
  y: 128,
  z: 250,
  dz: 0,
  theta: 0,
  pitch: -Math.PI * .15
};

var canvas = document.querySelector("canvas");
var context = canvas.getContext("2d");
canvas.width = WIDTH;
canvas.height = HEIGHT;

var depthBuffer = new Float32Array(WIDTH * HEIGHT);
// var renderBytes = new Uint8ClampedArray(renderBuffer.buffer);
// var renderBuffer = new Uint32Array(WIDTH * HEIGHT);
var imageData = new ImageData(WIDTH, HEIGHT);
var renderBytes = imageData.data;
var renderBuffer = new Uint32Array(renderBytes.buffer);

// determine the pixel order on this platform
// should be ABGR, but might differ on non-x86
function getByteShifts() {
  var bytes = new Uint8Array(4);
  var long = new Uint32Array(bytes.buffer);
  var shifts = [];
  for (var i = 0; i < 4; i++) {
    bytes.set(Array.from({ length: 4 }, (_, n) => n == i ? 1 : 0));
    // from Hacker's Delight pg 11, x & -x isolates the rightmost set bit
    // then a log2 to get its position
    shifts.push(Math.log2(long[0] & -long[0]));
  }
  return shifts;
}
const [RED_SHIFT, GREEN_SHIFT, BLUE_SHIFT, ALPHA_SHIFT] = getByteShifts();
const CLEAR = 0xFF << ALPHA_SHIFT;

function render(camera) {
  // clear the depth and render buffers
  depthBuffer.fill(MAX_DEPTH);
  renderBuffer.fill(0xFFFFFFFF);
  // TODO: render sprites, including their depth buffer position
  // draw rays for each column from the bottom up
  columns: for (var c = 0; c < WIDTH; c++) {
    var distance = 1;
    // compute the unit steps for this column
    var theta = COL_RATIO[c] + camera.theta;
    var stepX = Math.cos(theta);
    var stepY = Math.sin(theta);
    // TODO: we should absolutely use a vector array to handle the ray position
    var rx = camera.x + stepX;
    var ry = camera.y + stepY;
    rows: for (var r = HEIGHT - 1; r >= 0; r--) {
      if (distance >= MAX_DEPTH) break rows;
      // compute unit steps for the row
      var decline = ROW_RATIO[r] + camera.pitch;
      var stepZ = Math.sin(decline);
      var rz = camera.z + distance * stepZ;
      cast: while (distance < MAX_DEPTH) {
        // we're adding the width and height here to effectively force the numbers into a positive domain
        // there's a bitwise trick to this too, but I don't fully trust it
        var x = ((rx + heightmap.width) | 0) % heightmap.width;
        var y = ((ry + heightmap.height) | 0) % heightmap.height;
        var ground = heightmap.map[x + y * heightmap.width];
        if (rz < ground) {
          var pixel = c + r * WIDTH;
          if (distance < depthBuffer[pixel]) {
            var v = 512 - distance >> 1;
            var red = 0xFF << RED_SHIFT;
            var green = ground << GREEN_SHIFT;
            var blue = (255 - ground) << BLUE_SHIFT;
            // var red = v << RED_SHIFT;
            // var green = v << GREEN_SHIFT;
            // var blue = v << BLUE_SHIFT;
            var alpha = 0xFF << ALPHA_SHIFT;
            var color = red | green | blue | alpha;
            renderBuffer[pixel] = color;
            depthBuffer[pixel] = distance;
          }
          break cast;
        }
        var step = distance > 128 ? 4 :
          distance > 64 ? 3 :
          distance > 32 ? 2 :
          1;
        distance += step;
        rx += stepX * step;
        ry += stepY * step;
        rz += stepZ * step;
      }
    }
  }
  context.putImageData(imageData, 0, 0);
}

var last = 0;
const FRAME_TIME = 16.7;
function tick(time) {
  render(camera);
  if (!last) {
    last = time - 100;
  }
  var scaler = (time - last) / FRAME_TIME;
  camera.theta += .005 * scaler;
  camera.x = (camera.x + 1 * scaler) % heightmap.width;
  camera.y = (camera.y + 1 * scaler) % heightmap.height;
  var floor = heightmap.map[camera.x|0 + camera.y|0 * heightmap.width] + 80;
  if (camera.z < floor) {
    camera.dz += .02 * scaler;
  } else {
    camera.dz -= .005 * scaler;
  }
  camera.z += camera.dz * scaler;
  if (camera.dz > .5) {
    camera.dz = .5;
  }
  if (camera.dz < -.5) {
    camera.dz = -.5;
  }
  last = time;
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);