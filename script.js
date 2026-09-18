(function(){
  'use strict';

  /* =====================================================================
     KAGEURI: NEON RUN
     Single-file arcade racer. Three.js for rendering, hand-rolled arcade
     car physics (no physics engine — intentional, per design brief).
  ===================================================================== */

  // ---------------------------------------------------------------
  // CONSTANTS / PALETTE
  // ---------------------------------------------------------------
  const COLORS = {
    void: 0x05030A,
    deep: 0x0D0A18,
    road: 0x14101f,
    magenta: 0xFF2E92,
    cyan: 0x00F0FF,
    gold: 0xFFD84D,
    violet: 0x7A2BFF,
  };

  const BIKE_COLORS = [
    { name:'Magenta', hex: 0xFF2E92 },
    { name:'Cyan',    hex: 0x00F0FF },
    { name:'Gold',    hex: 0xFFD84D },
    { name:'Violet',  hex: 0x7A2BFF },
  ];

  const TRACK_WIDTH = 16;
  const LAPS_TO_WIN = 3;

  // ---------------------------------------------------------------
  // TRACK DEFINITION
  // A closed loop built from control points. Sections roughly map to
  // the brief: fast straight -> technical corners -> tunnel -> jump ->
  // highway -> back to start.
  // ---------------------------------------------------------------
  const controlPoints = [
    new THREE.Vector3(0, 0, 0),          // start/finish
    new THREE.Vector3(0, 0, -140),       // long straight
    new THREE.Vector3(40, 0, -210),      // technical: sweep right
    new THREE.Vector3(110, 0, -220),
    new THREE.Vector3(150, 0, -180),     // hairpin-ish
    new THREE.Vector3(150, 0, -110),
    new THREE.Vector3(110, 0, -70),
    new THREE.Vector3(120, -2, -10),     // dip into tunnel
    new THREE.Vector3(120, -2, 60),      // tunnel section (lowered, roofed)
    new THREE.Vector3(90, 0, 110),       // exit tunnel, rise back up
    new THREE.Vector3(40, 6, 150),       // ramp / jump section (raised)
    new THREE.Vector3(-20, 0, 165),      // land
    new THREE.Vector3(-90, 0, 150),      // highway sweep
    new THREE.Vector3(-140, 0, 90),
    new THREE.Vector3(-140, 0, 20),
    new THREE.Vector3(-90, 0, -30),
    new THREE.Vector3(-40, 0, -20),
    new THREE.Vector3(-20, 0, 20),       // curl back toward start
  ];

  const trackCurve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.5);
  const TRACK_SAMPLES = 900;
  const trackPoints = trackCurve.getSpacedPoints(TRACK_SAMPLES);
  const trackTangents = trackPoints.map((p, i) => {
    const t = i / TRACK_SAMPLES;
    return trackCurve.getTangent(t).normalize();
  });
  const totalTrackLength = trackCurve.getLength();

  // Approximate "u" (0..1) marker for tunnel & ramp sections, used for
  // visual triggers (fog change, airborne behavior).
  function nearestU(point){
    let best = 0, bestDist = Infinity;
    for(let i=0;i<trackPoints.length;i++){
      const d = trackPoints[i].distanceToSquared(point);
      if(d < bestDist){ bestDist = d; best = i; }
    }
    return best / TRACK_SAMPLES;
  }
  const tunnelStartU = nearestU(new THREE.Vector3(120,-2,-10));
  const tunnelEndU   = nearestU(new THREE.Vector3(90,0,110));
  const rampU        = nearestU(new THREE.Vector3(40,6,150));

  function sampleTrack(u){
    // u in [0,1)
    u = ((u % 1) + 1) % 1;
    const idx = u * TRACK_SAMPLES;
    const i0 = Math.floor(idx) % TRACK_SAMPLES;
    const i1 = (i0 + 1) % TRACK_SAMPLES;
    const f = idx - Math.floor(idx);
    const pos = trackPoints[i0].clone().lerp(trackPoints[i1], f);
    const tan = trackTangents[i0].clone().lerp(trackTangents[i1], f).normalize();
    return { pos, tan, u };
  }

  // ---------------------------------------------------------------
  // SCENE SETUP
  // ---------------------------------------------------------------
  const canvas = document.createElement('canvas');
  document.getElementById('app').appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(COLORS.void, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.void, 0.0068);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.1, 2000);

  // lighting
  const hemi = new THREE.HemisphereLight(0x4444ff, 0x0a0a12, 0.55);
  scene.add(hemi);
  const magentaLight = new THREE.PointLight(COLORS.magenta, 1.4, 220, 2);
  magentaLight.position.set(0, 40, 0);
  scene.add(magentaLight);
  const cyanLight = new THREE.PointLight(COLORS.cyan, 1.0, 260, 2);
  cyanLight.position.set(60, 50, -100);
  scene.add(cyanLight);
  const ambient = new THREE.AmbientLight(0x201030, 0.6);
  scene.add(ambient);

  // ---------------------------------------------------------------
  // ROAD MESH (ribbon along the spline)
  // ---------------------------------------------------------------
  function buildRoad(){
    const positions = [];
    const uvs = [];
    const indices = [];
    const up = new THREE.Vector3(0,1,0);

    for(let i=0;i<=TRACK_SAMPLES;i++){
      const s = sampleTrack(i/TRACK_SAMPLES);
      const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
      const left = s.pos.clone().addScaledVector(side, TRACK_WIDTH/2);
      const right = s.pos.clone().addScaledVector(side, -TRACK_WIDTH/2);
      positions.push(left.x, left.y, left.z);
      positions.push(right.x, right.y, right.z);
      uvs.push(0, i*0.15); uvs.push(1, i*0.15);
    }
    for(let i=0;i<TRACK_SAMPLES;i++){
      const a=i*2, b=i*2+1, c=i*2+2, d=i*2+3;
      indices.push(a,b,c, b,d,c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.road, roughness:0.75, metalness:0.15,
      emissive: 0x0a0616, emissiveIntensity:0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    scene.add(mesh);

    // Neon edge strips (glowing lines along both edges)
    [1, -1].forEach((sign)=>{
      const stripPos = [];
      for(let i=0;i<=TRACK_SAMPLES;i++){
        const s = sampleTrack(i/TRACK_SAMPLES);
        const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
        const p = s.pos.clone().addScaledVector(side, sign*(TRACK_WIDTH/2 - 0.15));
        p.y += 0.12;
        stripPos.push(p.x,p.y,p.z);
      }
      const stripGeo = new THREE.BufferGeometry();
      stripGeo.setAttribute('position', new THREE.Float32BufferAttribute(stripPos,3));
      const stripMat = new THREE.LineBasicMaterial({
        color: sign>0 ? COLORS.magenta : COLORS.cyan, linewidth:2,
        transparent:true, opacity:0.95,
      });
      const line = new THREE.LineLoop(stripGeo, stripMat);
      scene.add(line);
    });
  }
  buildRoad();

  // ground plane beyond the road (dark reflective-ish floor)
  {
    const groundGeo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x070510, roughness:0.9, metalness:0.1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI/2;
    ground.position.y = -0.05;
    scene.add(ground);
  }

  // ---------------------------------------------------------------
  // CITY: buildings, billboards, particles
  // ---------------------------------------------------------------
  // Distance from a world point to the NEAREST point anywhere on the track loop
  // (not just the locally-sampled section). This is the key fix: the track
  // loops back near itself (hairpin + return-to-start), so a building placed
  // relative to one section could otherwise land right on top of a different
  // section that happens to pass nearby in world space.
  function distToTrackAnywhere(point){
    let best = Infinity;
    for(let i=0;i<trackPoints.length;i+=2){ // every 2nd sample — plenty of resolution, cheap
      const dx = point.x - trackPoints[i].x;
      const dz = point.z - trackPoints[i].z;
      const d = Math.sqrt(dx*dx+dz*dz);
      if(d < best) best = d;
    }
    return best;
  }

  function buildCity(){
    const buildingGeo = new THREE.BoxGeometry(1,1,1);
    const buildingMatA = new THREE.MeshStandardMaterial({ color:0x0e0c18, roughness:0.6, metalness:0.3, emissive:0x1a0a2a, emissiveIntensity:0.3 });
    const buildingMatB = new THREE.MeshStandardMaterial({ color:0x0a0f1a, roughness:0.6, metalness:0.3, emissive:0x0a1a2a, emissiveIntensity:0.3 });

    const count = 140;
    const instA = new THREE.InstancedMesh(buildingGeo, buildingMatA, count);
    const instB = new THREE.InstancedMesh(buildingGeo, buildingMatB, count);
    let ai=0, bi=0;
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0,1,0);
    const SAFE_CLEARANCE = TRACK_WIDTH/2 + 14; // extra margin — also protects the trailing camera from clipping into buildings on sharp corners

    for(let i=0;i<count;i++){
      const u = i/count;
      const s = sampleTrack(u + (Math.random()-0.5)*0.01);
      const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
      const sign = Math.random()<0.5 ? 1 : -1;
      const h = 18 + Math.random()*70;
      const w = 6 + Math.random()*10;
      const halfDiag = w * 0.72; // rough footprint radius so we clear by the building's own size too

      let dist = TRACK_WIDTH/2 + 14 + Math.random()*40;
      let pos = s.pos.clone().addScaledVector(side, sign*dist);
      let attempts = 0;
      while(distToTrackAnywhere(pos) < SAFE_CLEARANCE + halfDiag && attempts < 8){
        dist += 14;
        pos = s.pos.clone().addScaledVector(side, sign*dist);
        attempts++;
      }
      if(attempts >= 8) continue; // couldn't find a clear spot near this point — skip rather than risk overlap

      dummy.position.set(pos.x, h/2, pos.z);
      dummy.scale.set(w, h, w);
      dummy.rotation.y = Math.random()*Math.PI;
      dummy.updateMatrix();
      if(sign>0){ instA.setMatrixAt(ai++, dummy.matrix); } else { instB.setMatrixAt(bi++, dummy.matrix); }
    }
    instA.count = ai; instB.count = bi;
    instA.instanceMatrix.needsUpdate = true;
    instB.instanceMatrix.needsUpdate = true;
    scene.add(instA, instB);

    // window glow strips (fake — thin emissive planes on a subset of buildings)
    // kept simple: colored point lights scattered as "holographic ad" glows
    for(let i=0;i<18;i++){
      const u = i/18;
      const s = sampleTrack(u);
      const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
      const sign = i%2===0 ? 1 : -1;
      const pos = s.pos.clone().addScaledVector(side, sign*(TRACK_WIDTH/2+6));
      pos.y = 8 + Math.random()*10;
      const color = [COLORS.magenta, COLORS.cyan, COLORS.gold][i%3];
      const l = new THREE.PointLight(color, 0.9, 40, 2);
      l.position.copy(pos);
      scene.add(l);
    }
  }
  buildCity();

  // KAGEURI holographic billboards at intervals
  function buildBillboards(){
    const loader = null; // no external font/texture loading — draw text to canvas texture
    function makeTextTexture(text, color){
      const c = document.createElement('canvas');
      c.width = 512; c.height = 160;
      const ctx = c.getContext('2d');
      ctx.clearRect(0,0,c.width,c.height);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0,0,c.width,c.height);
      ctx.font = 'italic 800 84px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, c.width/2, c.height/2);
      ctx.shadowBlur = 30;
      ctx.fillText(text, c.width/2, c.height/2);
      const tex = new THREE.CanvasTexture(c);
      tex.needsUpdate = true;
      return tex;
    }
    const tex1 = makeTextTexture('KAGEURI', '#FF2E92');
    const tex2 = makeTextTexture('NEON RUN', '#00F0FF');
    const up = new THREE.Vector3(0,1,0);
    const spots = 6;
    for(let i=0;i<spots;i++){
      const u = (i+0.5)/spots;
      const s = sampleTrack(u);
      const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
      const sign = i%2===0 ? 1 : -1;
      const pos = s.pos.clone().addScaledVector(side, sign*(TRACK_WIDTH/2+3));
      pos.y = 14 + (i%3)*3;
      const tex = i%2===0 ? tex1 : tex2;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent:true, side: THREE.DoubleSide, depthWrite:false });
      const geo = new THREE.PlaneGeometry(16, 5);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.lookAt(s.pos.x, pos.y, s.pos.z);
      scene.add(mesh);
    }
  }
  buildBillboards();

  // Tunnel: a tube covering the lowered section
  function buildTunnel(){
    const segCount = 60;
    const points = [];
    for(let i=0;i<=segCount;i++){
      const u = tunnelStartU + (tunnelEndU - tunnelStartU + 1)%1 * (i/segCount);
      points.push(sampleTrack(u).pos.clone());
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, 60, TRACK_WIDTH*0.85, 16, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x0a0716, side: THREE.BackSide, roughness:0.5, metalness:0.4,
      emissive: 0x220a33, emissiveIntensity:0.5,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    scene.add(tube);

    // ring lights inside tunnel
    for(let i=0;i<=10;i++){
      const p = curve.getPointAt(i/10);
      const l = new THREE.PointLight(i%2===0?COLORS.cyan:COLORS.magenta, 1.2, 30, 2);
      l.position.copy(p).add(new THREE.Vector3(0,6,0));
      scene.add(l);
    }
  }
  buildTunnel();

  // Floating particles (atmosphere)
  function buildParticles(){
    const N = 400;
    const positions = new Float32Array(N*3);
    for(let i=0;i<N;i++){
      positions[i*3+0] = (Math.random()-0.5)*500;
      positions[i*3+1] = Math.random()*80;
      positions[i*3+2] = (Math.random()-0.5)*500;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    const mat = new THREE.PointsMaterial({
      color: COLORS.cyan, size:0.6, transparent:true, opacity:0.5,
      blending: THREE.AdditiveBlending, depthWrite:false,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return pts;
  }
  const particles = buildParticles();

  // Dynamic sky (gradient sphere)
  function buildSky(){
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const c = document.createElement('canvas');
    c.width = 2; c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0,0,0,256);
    grad.addColorStop(0, '#120827');
    grad.addColorStop(0.45, '#1a0a33');
    grad.addColorStop(0.75, '#2a0e2a');
    grad.addColorStop(1, '#05030A');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,2,256);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map:tex, side: THREE.BackSide, fog:false, depthWrite:false });
    const sky = new THREE.Mesh(skyGeo, mat);
    scene.add(sky);
  }
  buildSky();

  // ---------------------------------------------------------------
  // COLLECTIBLES: coins & boost pickups along track
  // ---------------------------------------------------------------
  const coins = [];
  const boostPickups = [];
  function buildCollectibles(){
    const coinGeo = new THREE.CylinderGeometry(0.9,0.9,0.18,14);
    const coinMat = new THREE.MeshStandardMaterial({ color:COLORS.gold, emissive:COLORS.gold, emissiveIntensity:0.9, metalness:0.6, roughness:0.3 });
    const boostGeo = new THREE.ConeGeometry(1.0, 1.8, 6);
    const boostMat = new THREE.MeshStandardMaterial({ color:COLORS.magenta, emissive:COLORS.magenta, emissiveIntensity:1.0, metalness:0.4, roughness:0.3 });

    const up = new THREE.Vector3(0,1,0);
    const N_COINS = 90;
    for(let i=0;i<N_COINS;i++){
      const u = (i/N_COINS + 0.004*(i%3));
      const s = sampleTrack(u);
      const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
      const lane = ((i%3)-1) * (TRACK_WIDTH*0.28);
      const pos = s.pos.clone().addScaledVector(side, lane);
      pos.y += 1.1;
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.copy(pos);
      mesh.rotation.x = Math.PI/2;
      scene.add(mesh);
      coins.push({ mesh, u, active:true });
    }
    const N_BOOST = 22;
    for(let i=0;i<N_BOOST;i++){
      const u = (i+0.5)/N_BOOST;
      const s = sampleTrack(u);
      const pos = s.pos.clone();
      pos.y += 1.0;
      const mesh = new THREE.Mesh(boostGeo, boostMat);
      mesh.position.copy(pos);
      scene.add(mesh);
      boostPickups.push({ mesh, u, active:true, cooldown:0 });
    }
  }
  buildCollectibles();

  // ---------------------------------------------------------------
  // VEHICLE FACTORY (player + AI share this)
  // ---------------------------------------------------------------
  function buildBikeMesh(colorHex){
    const group = new THREE.Group();
    // Contrasting neon trim so branding pops regardless of chosen body color
    const accentHex = (colorHex === COLORS.cyan) ? COLORS.magenta : COLORS.cyan;

    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness:0.7, roughness:0.28, emissive: colorHex, emissiveIntensity:0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0f, metalness:0.5, roughness:0.5 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness:0.85, roughness:0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity:1.8 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity:2.0 });
    const headlightMat = new THREE.MeshStandardMaterial({ color:0xffffff, emissive:0xffffff, emissiveIntensity:2.2 });
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x14121c, metalness:0.3, roughness:0.55, emissive: 0x0a0612, emissiveIntensity:0.4 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x17151f, metalness:0.6, roughness:0.2, emissive: 0x0a0612, emissiveIntensity:0.3 });

    // --- main frame spine (rear axle area up to the headstock) ---
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 2.15, 6), metalMat);
    frame.rotation.x = Math.PI/2;
    frame.position.set(0, 0.56, 0.05);
    group.add(frame);

    // --- fuel tank (rounded, sits over the frame) ---
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bodyMat);
    tank.scale.set(1.05, 0.62, 1.15);
    tank.position.set(0, 0.76, 0.5);
    group.add(tank);

    // --- seat ---
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.85), darkMat);
    seat.position.set(0, 0.68, -0.55);
    group.add(seat);

    // --- tail unit (holds the tail light) ---
    const tailUnit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.4), bodyMat);
    tailUnit.position.set(0, 0.68, -1.15);
    tailUnit.rotation.x = 0.25;
    group.add(tailUnit);

    // --- front fork assembly (wheel + fender + handlebars + headlight),
    // grouped separately so it can visually turn with steering input ---
    const frontFork = new THREE.Group();
    frontFork.position.set(0, 0, 1.25);
    group.add(frontFork);

    const frontWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.24,14), darkMat);
    frontWheel.rotation.z = Math.PI/2;
    frontWheel.position.set(0, 0.42, 0);
    frontFork.add(frontWheel);
    const frontRim = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.26,10), accentMat);
    frontRim.rotation.z = Math.PI/2;
    frontWheel.add(frontRim);

    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.14,10,1,false,0,Math.PI*0.9), darkMat);
    fender.rotation.z = Math.PI/2;
    fender.position.set(0, 0.62, 0);
    frontFork.add(fender);

    const forkTube = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.75,6), metalMat);
    forkTube.position.set(0, 0.75, 0.02);
    frontFork.add(forkTube);

    [-0.28, 0.28].forEach(x=>{
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.42,6), darkMat);
      bar.rotation.z = Math.PI/2.3;
      bar.position.set(x*0.7, 1.1, -0.05);
      frontFork.add(bar);
    });

    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.16,0.1), headlightMat);
    headlight.position.set(0, 1.02, 0.18);
    frontFork.add(headlight);
    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.22,0.16), bodyMat);
    fairing.position.set(0, 1.0, 0.05);
    frontFork.add(fairing);

    // --- rear wheel (drive wheel, spins with speed) ---
    const rearWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.26,14), darkMat);
    rearWheel.rotation.z = Math.PI/2;
    rearWheel.position.set(0, 0.42, -1.15);
    group.add(rearWheel);
    const rearRim = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.28,10), accentMat);
    rearRim.rotation.z = Math.PI/2;
    rearWheel.add(rearRim);

    // --- exhaust pipe (side-mounted, as on a real bike) ---
    const exhaustPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,1.1,8), metalMat);
    exhaustPipe.rotation.x = Math.PI/2;
    exhaustPipe.position.set(0.28, 0.42, -0.75);
    group.add(exhaustPipe);

    // --- neon spine accent (brand trim, headstock to tail) ---
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 1.9), accentMat);
    spine.position.set(0, 0.62, -0.1);
    group.add(spine);

    // --- rider: simplified, tucked-forward racing posture ---
    const rider = new THREE.Group();
    rider.position.set(0, 0.9, -0.25);
    rider.rotation.x = -0.35; // leaned forward over the tank
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.32), suitMat);
    torso.position.set(0, 0.3, 0);
    rider.add(torso);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), suitMat);
    shoulders.position.set(0, 0.56, 0.02);
    rider.add(shoulders);

    // arms reaching down to the handlebars — without these the rider read as
    // a floating block rather than a person
    [-0.28, 0.28].forEach(x=>{
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.11), suitMat);
      arm.position.set(x, 0.42, 0.28);
      arm.rotation.x = -0.5; // angled down/forward toward the bars
      rider.add(arm);
    });

    // suit accent stripe — racing-livery style trim so the rider has some
    // contrast against a dark, foggy scene instead of blending into it
    const suitStripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.05), accentMat);
    suitStripe.position.set(0, 0.32, -0.14);
    rider.add(suitStripe);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), helmetMat);
    helmet.position.set(0, 0.78, 0.08);
    rider.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.06), accentMat);
    visor.position.set(0, 0.78, 0.2);
    rider.add(visor);
    group.add(rider);

    // underglow (additive plane beneath bike — narrower footprint than a car)
    const glowGeo = new THREE.PlaneGeometry(1.7, 3.4);
    const glowPlaneMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false });
    const underglow = new THREE.Mesh(glowGeo, glowPlaneMat);
    underglow.rotation.x = -Math.PI/2;
    underglow.position.y = 0.05;
    group.add(underglow);

    // tail light (glow)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.32,0.12,0.06), glowMat);
    tail.position.set(0, 0.68, -1.32);
    group.add(tail);

    // exhaust glow sprite (visible on boost) — positioned at the pipe tip
    const exGeo = new THREE.PlaneGeometry(0.55,0.55);
    const exMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false });
    const exhaust = new THREE.Mesh(exGeo, exMat);
    exhaust.position.set(0.28, 0.42, -1.35);
    group.add(exhaust);

    group.userData.wheels = [rearWheel, frontWheel];
    group.userData.frontFork = frontFork; // rotated on Y for a visual steering/handlebar effect
    group.userData.exhaust = exhaust;
    group.userData.underglow = underglow;
    return group;
  }

  // ---------------------------------------------------------------
  // RACER STATE (shared logic for player + AI)
  // ---------------------------------------------------------------
  function makeRacer(colorHex, isPlayer, skill){
    const mesh = buildBikeMesh(colorHex);
    scene.add(mesh);
    return {
      mesh,
      isPlayer: !!isPlayer,
      skill: skill || 0.8,               // 0..1, higher = better AI
      u: 0,                              // progress along track [0,1) this lap
      lateral: 0,                        // signed offset from centerline
      lap: 0,
      speed: 0,
      heading: 0,                        // radians, for player free-steer blend
      drifting: false,
      driftDir: 0,
      driftTime: 0,
      boost: 0,                          // 0..100
      boosting: false,
      boostTimer: 0,
      airborne: false,
      airTime: 0,
      verticalVel: 0,
      coinCount: 0,
      totalDistance: 0,                  // for position ranking
      mistakeTimer: Math.random()*4,
      mistakeOffset: 0,
      finished:false,
      finishTime:0,
    };
  }

  const bikeColorHexList = BIKE_COLORS.map(c=>c.hex);
  let selectedColorIdx = 0;

  let player = null;
  const aiRacers = [];
  const ALL_RACERS = [];

  function setupRace(){
    // clear old
    [player, ...aiRacers].forEach(r=>{ if(r) scene.remove(r.mesh); });
    aiRacers.length = 0; ALL_RACERS.length = 0;

    player = makeRacer(bikeColorHexList[selectedColorIdx], true);
    ALL_RACERS.push(player);

    const aiColors = bikeColorHexList.filter((_,i)=>i!==selectedColorIdx);
    const skills = [0.72, 0.82, 0.9];
    for(let i=0;i<3;i++){
      const ai = makeRacer(aiColors[i % aiColors.length], false, skills[i]);
      ai.u = 0; // NOTE: previously -0.01*(i+1) — negative u wraps to ~0.98-0.99 in
                // sampleTrack, which falsely read as "98% of a lap already done"
                // for ranking. Lateral stagger below is enough for a clean grid start.
      aiRacers.push(ai);
      ALL_RACERS.push(ai);
    }
    // stagger starting lateral positions so cars don't overlap
    player.lateral = 0;
    aiRacers[0].lateral = -4;
    aiRacers[1].lateral = 4;
    aiRacers[2].lateral = -2;
  }
  setupRace();

  // ---------------------------------------------------------------
  // INPUT
  // ---------------------------------------------------------------
  const input = { up:false, down:false, left:false, right:false, drift:false, boost:false };

  window.addEventListener('keydown', (e)=>{
    switch(e.code){
      case 'KeyW': case 'ArrowUp': input.up=true; break;
      case 'KeyS': case 'ArrowDown': input.down=true; break;
      case 'KeyA': case 'ArrowLeft': input.left=true; break;
      case 'KeyD': case 'ArrowRight': input.right=true; break;
      case 'ShiftLeft': case 'ShiftRight': input.drift=true; break;
      case 'Space': input.boost=true; e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', (e)=>{
    switch(e.code){
      case 'KeyW': case 'ArrowUp': input.up=false; break;
      case 'KeyS': case 'ArrowDown': input.down=false; break;
      case 'KeyA': case 'ArrowLeft': input.left=false; break;
      case 'KeyD': case 'ArrowRight': input.right=false; break;
      case 'ShiftLeft': case 'ShiftRight': input.drift=false; break;
      case 'Space': input.boost=false; break;
    }
  });

  // touch controls
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if(isTouch){ document.getElementById('touchControls').classList.add('active'); }
  function bindTouch(id, onDown, onUp){
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e)=>{ e.preventDefault(); onDown(); }, {passive:false});
    el.addEventListener('touchend', (e)=>{ e.preventDefault(); onUp(); }, {passive:false});
    el.addEventListener('touchcancel', ()=>onUp());
  }
  bindTouch('tGas', ()=>input.up=true, ()=>input.up=false);
  bindTouch('tBrake', ()=>input.down=true, ()=>input.down=false);
  bindTouch('tLeft', ()=>input.left=true, ()=>input.left=false);
  bindTouch('tRight', ()=>input.right=true, ()=>input.right=false);
  bindTouch('tBoost', ()=>{input.drift=true; input.boost=true;}, ()=>{input.drift=false; input.boost=false;});

  // ---------------------------------------------------------------
  // PHYSICS TUNING
  // ---------------------------------------------------------------
  const PHYS = {
    maxSpeed: 46,           // units/sec baseline top speed
    boostMaxSpeed: 68,
    accel: 26,
    brakeDecel: 46,
    coastDecel: 10,
    steerRate: 1.9,         // rad/sec at low speed
    lateralGripSpeed: 34,   // lateral units/sec correction toward heading
    driftLateralBoost: 1.6,
    boostDrainPerSec: 34,   // consumes 0-100 meter over ~3s
    boostGainDrift: 22,     // per second while drifting
    boostGainPickup: 35,
  };

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function lerpAngle(a,b,t){
    let diff = ((b - a + Math.PI) % (Math.PI*2) + Math.PI*2) % (Math.PI*2) - Math.PI;
    return a + diff*t;
  }

  // ---------------------------------------------------------------
  // RACE STATE / TIMER / UI REFS
  // ---------------------------------------------------------------
  let raceState = 'menu'; // 'menu' | 'countdown' | 'racing' | 'finished'
  let raceTime = 0;
  let globalTime = 0; // free-running clock for ambient visual pulsing (e.g. nitro canister glow)
  let countdownVal = 3;
  let countdownTimer = 0;

  const el = {
    hud: document.getElementById('hud'),
    lapLabel: document.getElementById('lapLabel'),
    posLabel: document.getElementById('posLabel'),
    coinLabel: document.getElementById('coinLabel'),
    speedLabel: document.getElementById('speedLabel'),
    boostFill: document.getElementById('boostFill'),
    boostLabel: document.getElementById('boostLabel'),
    driftPopup: document.getElementById('driftPopup'),
    nitroPopup: document.getElementById('nitroPopup'),
    speedLines: document.getElementById('speedLines'),
    countdown: document.getElementById('countdown'),
    startScreen: document.getElementById('startScreen'),
    finishScreen: document.getElementById('finishScreen'),
    finishTitle: document.getElementById('finishTitle'),
    finishPos: document.getElementById('finishPos'),
    finishTime: document.getElementById('finishTime'),
    finishCoins: document.getElementById('finishCoins'),
  };

  // bike select UI
  (function buildBikeSelect(){
    const row = document.getElementById('bikeSelectRow');
    BIKE_COLORS.forEach((c, i)=>{
      const div = document.createElement('div');
      div.className = 'bike-swatch' + (i===0?' active':'');
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = '#'+c.hex.toString(16).padStart(6,'0');
      dot.style.boxShadow = '0 0 10px #'+c.hex.toString(16).padStart(6,'0');
      div.appendChild(dot);
      div.addEventListener('click', ()=>{
        selectedColorIdx = i;
        [...row.children].forEach(ch=>ch.classList.remove('active'));
        div.classList.add('active');
      });
      row.appendChild(div);
    });
  })();

  document.getElementById('startBtn').addEventListener('click', startRace);
  document.getElementById('restartBtn').addEventListener('click', ()=>{
    el.finishScreen.classList.add('hidden');
    startRace();
  });

  function startRace(){
    setupRace();
    coins.forEach(c=>{ c.active=true; c.mesh.visible=true; });
    boostPickups.forEach(b=>{ b.active=true; b.mesh.visible=true; b.cooldown=0; });
    el.startScreen.classList.add('hidden');
    el.hud.classList.remove('hidden');
    raceTime = 0;
    countdownVal = 3;
    countdownTimer = 0;
    raceState = 'countdown';
    el.countdown.classList.remove('hidden');
    el.countdown.textContent = '3';
  }

  // ---------------------------------------------------------------
  // UPDATE: RACER (shared step for player & AI)
  // ---------------------------------------------------------------
  function updateRacer(r, dt, controls){
    // controls: {throttle:-1..1, steer:-1..1, drift:bool, boostReq:bool}
    const up = new THREE.Vector3(0,1,0);

    // --- speed ---
    const targetMax = r.boosting ? PHYS.boostMaxSpeed : PHYS.maxSpeed;
    if(controls.throttle > 0){
      r.speed += PHYS.accel * controls.throttle * dt;
    } else if(controls.throttle < 0){
      r.speed += PHYS.brakeDecel * controls.throttle * dt;
    } else {
      r.speed -= Math.sign(r.speed) * PHYS.coastDecel * dt;
    }
    r.speed = clamp(r.speed, -PHYS.maxSpeed*0.4, targetMax);
    if(Math.abs(r.speed) < 0.05) r.speed = 0;

    // --- boost meter & activation ---
    if(controls.drift){
      r.boost = clamp(r.boost + PHYS.boostGainDrift*dt, 0, 100);
    }
    if(controls.boostReq && r.boost >= 20 && !r.boosting){
      r.boosting = true;
      r.boostTimer = 0;
    }
    if(r.boosting){
      r.boostTimer += dt;
      r.boost = clamp(r.boost - PHYS.boostDrainPerSec*dt, 0, 100);
      if(r.boost <= 0){ r.boosting = false; }
    }

    // --- drift state ---
    const wantDrift = controls.drift && Math.abs(r.speed) > PHYS.maxSpeed*0.35 && Math.abs(controls.steer) > 0.15;
    if(wantDrift && !r.drifting){
      r.drifting = true; r.driftDir = Math.sign(controls.steer); r.driftTime = 0;
    }
    if(!wantDrift && r.drifting){
      r.drifting = false;
    }
    if(r.drifting) r.driftTime += dt;

    // --- progress along track (u) ---
    const speedFrac = r.speed / Math.max(1, totalTrackLength);
    r.u += speedFrac * dt;
    if(r.u >= 1){ r.u -= 1; r.lap += 1; }
    if(r.u < 0){ r.u += 1; }
    r.totalDistance = r.lap * totalTrackLength + r.u*totalTrackLength;

    // --- lateral movement (steer relative to track centerline) ---
    const steerPower = controls.steer * PHYS.steerRate * (0.4 + 0.6*Math.min(1,Math.abs(r.speed)/20));
    const driftMul = r.drifting ? PHYS.driftLateralBoost : 1;
    // Lateral rate scales purely with actual speed now — it previously had a
    // hard floor (Math.max(2, ...)) meaning a fully STATIONARY car (speed 0)
    // could still slide sideways just from steering input, which looked like
    // random unpredictable drift whenever the car was slow/stopped.
    r.lateral += steerPower * driftMul * (Math.abs(r.speed) * 0.55) * dt;
    r.lateral = clamp(r.lateral, -(TRACK_WIDTH/2-1.2), TRACK_WIDTH/2-1.2);

    // --- sample track & place car ---
    const s = sampleTrack(r.u);
    const side = new THREE.Vector3().crossVectors(up, s.tan).normalize();
    const targetPos = s.pos.clone().addScaledVector(side, r.lateral);

    // airborne handling at ramp
    const onRampZone = Math.abs(r.u - rampU) < 0.012 || Math.abs(r.u - rampU + 1) < 0.012 || Math.abs(r.u - rampU - 1) < 0.012;
    if(r.rampCooldown === undefined) r.rampCooldown = 0;
    if(r.rampCooldown > 0) r.rampCooldown -= dt;
    if(onRampZone && !r.airborne && r.rampCooldown <= 0 && r.speed > PHYS.maxSpeed*0.5){
      r.airborne = true; r.airTime = 0; r.verticalVel = 9;
    }
    let extraY = 0;
    if(r.airborne){
      r.airTime += dt;
      r.verticalVel -= 22*dt;
      extraY = Math.max(0, r.verticalVel*r.airTime - 0.5*22*r.airTime*r.airTime);
      if(extraY <= 0 && r.airTime > 0.3){
        r.airborne = false; extraY = 0;
        // Cooldown after landing — without this, if the car is still inside
        // the ramp's (fairly wide) trigger zone the instant it lands and is
        // still fast enough, onRampZone would immediately be true again and
        // launch a second jump before the car had actually left the ramp.
        r.rampCooldown = 1.5;
      }
    }
    targetPos.y += extraY;

    r.mesh.position.copy(targetPos); // position is already smooth — it's a direct spline sample

    // Heading: face tangent, with a drift yaw offset & steer lean.
    // Both the yaw offset and the final heading are EASED rather than snapped —
    // previously an instant jump happened whenever drift toggled on/off, which
    // read as jerky "not smooth" driving. lerpAngle handles the ±π wrap so the
    // easing never whips the long way around.
    const baseHeading = Math.atan2(s.tan.x, s.tan.z);
    const desiredDriftYaw = r.drifting ? r.driftDir * 0.5 : controls.steer*0.12;
    if(r.smoothDriftYaw === undefined) r.smoothDriftYaw = desiredDriftYaw;
    r.smoothDriftYaw = lerp(r.smoothDriftYaw, desiredDriftYaw, 1 - Math.pow(0.0008, dt));

    const desiredHeading = baseHeading + Math.PI + r.smoothDriftYaw;
    if(r.smoothHeading === undefined) r.smoothHeading = desiredHeading;
    r.smoothHeading = lerpAngle(r.smoothHeading, desiredHeading, 1 - Math.pow(0.00004, dt));
    r.mesh.rotation.y = r.smoothHeading;
    // Motorcycle lean: bikes bank into corners far more dramatically than a
    // car body would, so this is deliberately a much larger angle than the
    // old car's cosmetic roll (0.06/0.08) — clamped so it reads as a lean,
    // not a crash.
    const targetLean = clamp(-controls.steer * 0.4 - (r.drifting? r.driftDir*0.45:0), -0.55, 0.55);
    if(r.smoothLean === undefined) r.smoothLean = 0;
    r.smoothLean = lerp(r.smoothLean, targetLean, 1 - Math.pow(0.002, dt));
    r.mesh.rotation.z = r.smoothLean;
    r.mesh.rotation.x = r.airborne ? clamp(r.verticalVel*0.02,-0.3,0.3) : 0;

    // Front fork turns visually with steering input — a bike-specific touch
    // the old car mesh had no equivalent of.
    if(r.mesh.userData.frontFork){
      const targetForkYaw = clamp(controls.steer * 0.5, -0.5, 0.5);
      r.mesh.userData.frontFork.rotation.y = lerp(r.mesh.userData.frontFork.rotation.y || 0, targetForkYaw, 1 - Math.pow(0.001, dt));
    }

    // wheel spin (visual only)
    const wheelSpin = (r.speed*dt) / 0.42;
    r.mesh.userData.wheels.forEach(w=>{ w.rotation.x += wheelSpin; });

    // exhaust glow visibility
    r.mesh.userData.exhaust.material.opacity = r.boosting ? 0.85 : 0;
    r.mesh.userData.underglow.material.opacity = r.drifting ? 0.85 : 0.5;

    // --- collectibles ---
    coins.forEach(c=>{
      if(!c.active) return;
      let du = Math.abs(c.u - r.u);
      if(du>0.5) du = 1-du;
      if(du < 0.006 && Math.abs(c.mesh.position.distanceTo(r.mesh.position)) < 2.4){
        c.active = false; c.mesh.visible = false;
        r.coinCount += 1;
      } else {
        c.mesh.rotation.z += dt*3;
      }
    });
    let gotNitro = false;
    boostPickups.forEach(b=>{
      if(b.cooldown>0){
        b.cooldown -= dt;
        if(b.cooldown<=0){ b.mesh.visible=true; b.active=true; }
        return;
      }
      if(!b.active) return;
      if(b.mesh.position.distanceTo(r.mesh.position) < 2.6){
        b.active = false; b.mesh.visible = false; b.cooldown = 6;
        r.boost = clamp(r.boost + PHYS.boostGainPickup, 0, 100);
        if(r.isPlayer) gotNitro = true;
      } else {
        b.mesh.rotation.y += dt*4;
        // pulsing nitro-canister glow so it reads as a distinct pickup, not a static prop
        b.mesh.material.emissiveIntensity = 1.0 + Math.sin(globalTime*6 + b.u*20)*0.5;
      }
    });

    return {
      justDrifted: r.drifting && r.driftTime>0.35 && r.driftTime-dt<=0.35,
      gotNitro,
    };
  }

  // ---------------------------------------------------------------
  // AI DECISION LOGIC
  // ---------------------------------------------------------------
  function updateAIControls(r, dt){
    r.mistakeTimer -= dt;
    if(r.mistakeTimer <= 0){
      r.mistakeTimer = 2 + Math.random()*3;
      r.mistakeOffset = (Math.random()-0.5) * (1-r.skill) * 6;
      // Drift intent is decided HERE (once per 2-5s cycle), not every frame.
      // It used to be re-rolled 60x/sec below, which flickered r.drifting
      // on/off many times per second and made AI cars visibly judder.
      r.driftDecision = Math.random() < r.skill;
    }
    if(r.driftDecision === undefined) r.driftDecision = Math.random() < r.skill;

    // Overtake awareness: bias away from a rival that's close ahead and in
    // roughly the same lane, attempting a pass. Previously AI only ever
    // targeted near-centerline and never reacted to other cars at all, so
    // "attempts to overtake" from the brief was never actually implemented.
    let overtakeBias = 0;
    for(const other of ALL_RACERS){
      if(other === r) continue;
      let du = other.u - r.u;
      if(du < -0.5) du += 1;
      if(du > 0.5) du -= 1;
      if(du > 0 && du < 0.035 && Math.abs(other.lateral - r.lateral) < 3.5){
        overtakeBias += (other.lateral > 0 ? -1 : 1) * 3.5 * r.skill;
      }
    }

    const desiredLateral = clamp(r.mistakeOffset + overtakeBias, -(TRACK_WIDTH/2-2), TRACK_WIDTH/2-2);
    const steerErr = clamp((desiredLateral - r.lateral)/4, -1, 1);

    // slow down for upcoming corners: sample curvature ahead
    const lookAheadU = r.u + 0.02;
    const a = sampleTrack(lookAheadU).tan;
    const b = sampleTrack(lookAheadU+0.02).tan;
    const turnSharpness = 1 - a.dot(b); // 0 straight, higher = sharper turn
    const cornerSlow = clamp(1 - turnSharpness*8*r.skill, 0.35, 1);

    const throttle = cornerSlow;
    const wantBoost = r.boost > 60 && Math.random() < 0.02;
    const wantDrift = Math.abs(steerErr) > 0.3 && r.driftDecision;

    return { throttle, steer: steerErr, drift: wantDrift, boostReq: wantBoost };
  }

  // ---------------------------------------------------------------
  // CAMERA
  // ---------------------------------------------------------------
  function updateCamera(dt){
    // IMPORTANT: uses the track tangent at the player's position, NOT the car
    // mesh's cosmetic rotation. The mesh rotation includes drift-yaw wobble;
    // following that directly let the camera swing wide on sharp corners
    // (like the hairpin) and clip into roadside buildings, which is what made
    // the car appear to "disappear" — you were briefly looking from inside a
    // building's geometry. The track tangent is smooth by construction, so
    // anchoring to it keeps the camera on a predictable, building-safe path.
    const s = sampleTrack(player.u);
    const back = s.tan.clone().negate();
    const desired = player.mesh.position.clone()
      .addScaledVector(back, 9.5)
      .add(new THREE.Vector3(0, 4.2, 0));
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    // Camera shake during nitro boost — from the original brief ("add camera
    // shake") but never actually implemented before.
    if(player.boosting){
      camera.position.x += (Math.random()-0.5) * 0.18;
      camera.position.y += (Math.random()-0.5) * 0.12;
    }
    const lookAt = player.mesh.position.clone().add(new THREE.Vector3(0,1.6,0));
    camera.lookAt(lookAt);
    const targetFov = player.boosting ? 84 : 72;
    camera.fov = lerp(camera.fov, targetFov, 1-Math.pow(0.0005,dt));
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------
  // UI UPDATE
  // ---------------------------------------------------------------
  let driftPopupTimer = 0;
  let nitroPopupTimer = 0;
  function updateUI(dt){
    // position ranking
    const ranked = [...ALL_RACERS].sort((a,b)=>b.totalDistance - a.totalDistance);
    const pos = ranked.indexOf(player) + 1;
    const suffix = pos===1?'ST':pos===2?'ND':pos===3?'RD':'TH';
    el.posLabel.innerHTML = pos + '<sup>'+suffix+'</sup>';
    el.lapLabel.textContent = 'LAP ' + Math.min(player.lap+1, LAPS_TO_WIN) + ' / ' + LAPS_TO_WIN;
    el.coinLabel.textContent = player.coinCount;
    el.speedLabel.textContent = Math.round(Math.abs(player.speed) * 3.2);
    el.boostFill.style.width = player.boost + '%';
    el.boostFill.classList.toggle('ready', player.boost>=20);
    el.boostLabel.textContent = player.boosting ? 'NITRO BOOST!' : (player.boost>=20 ? 'NITRO READY — SPACE' : 'NITRO');
    el.speedLines.style.opacity = player.boosting ? '0.55' : '0';

    if(driftPopupTimer>0){
      driftPopupTimer -= dt;
      el.driftPopup.style.opacity = clamp(driftPopupTimer/0.8, 0, 1);
    }
    if(nitroPopupTimer>0){
      nitroPopupTimer -= dt;
      el.nitroPopup.style.opacity = clamp(nitroPopupTimer/0.9, 0, 1);
    }
  }

  // ---------------------------------------------------------------
  // MAIN LOOP
  // ---------------------------------------------------------------
  let lastT = performance.now();
  function animate(){
    requestAnimationFrame(animate);
    const now = performance.now();
    let dt = (now - lastT)/1000;
    dt = Math.min(dt, 0.05);
    lastT = now;

    globalTime += dt;
    particles.rotation.y += dt*0.01;

    if(raceState === 'countdown'){
      countdownTimer += dt;
      if(countdownTimer >= 1){
        countdownTimer = 0;
        countdownVal -= 1;
        if(countdownVal <= 0){
          el.countdown.classList.add('hidden');
          raceState = 'racing';
        } else {
          el.countdown.textContent = String(countdownVal);
        }
      }
    }

    if(raceState === 'racing' || raceState === 'countdown'){
      // Cars must be positioned every frame during countdown too — previously
      // updateRacer only ran once raceState became 'racing', so all cars sat
      // stacked at the world origin through the whole 3-2-1 and then teleported
      // into their real grid spots the instant the race began. Passing neutral
      // (all-zero) controls during countdown keeps them correctly placed and
      // effectively motionless (any residual speed decays to 0 via coast decel)
      // without letting the player actually drive before "GO".
      const active = raceState === 'racing';
      raceTime += active ? dt : 0;

      const neutralControls = { throttle:0, steer:0, drift:false, boostReq:false };

      const steer = (input.left? -1:0) + (input.right?1:0);
      const throttle = (input.up?1:0) + (input.down?-1:0);
      const pc = active ? { throttle, steer, drift: input.drift, boostReq: input.boost } : neutralControls;
      const res = updateRacer(player, dt, pc);
      if(active && res.justDrifted){
        driftPopupTimer = 0.8;
      }
      if(active && res.gotNitro){
        nitroPopupTimer = 0.9;
      }

      aiRacers.forEach(ai=>{
        const ac = active ? updateAIControls(ai, dt) : neutralControls;
        updateRacer(ai, dt, ac);
      });

      if(active){
        // finish check
        if(!player.finished && player.lap >= LAPS_TO_WIN){
          player.finished = true;
          player.finishTime = raceTime;
        }
        aiRacers.forEach(ai=>{
          if(!ai.finished && ai.lap >= LAPS_TO_WIN){ ai.finished = true; ai.finishTime = raceTime; }
        });

        if(player.finished){
          finishRace();
        }
      }

      updateCamera(dt);
      updateUI(dt);
    }

    renderer.render(scene, camera);
  }

  function finishRace(){
    raceState = 'finished';
    const ranked = [...ALL_RACERS].sort((a,b)=>b.totalDistance - a.totalDistance);
    const pos = ranked.indexOf(player) + 1;
    const suffix = pos===1?'ST':pos===2?'ND':pos===3?'RD':'TH';
    el.finishPos.textContent = pos + suffix;
    const mins = Math.floor(raceTime/60);
    const secs = (raceTime%60).toFixed(1).padStart(4,'0');
    el.finishTime.textContent = String(mins).padStart(2,'0')+':'+secs;
    el.finishCoins.textContent = player.coinCount;
    el.finishTitle.textContent = pos===1 ? 'YOU WIN!' : 'RACE COMPLETE';
    el.hud.classList.add('hidden');
    setTimeout(()=>{ el.finishScreen.classList.remove('hidden'); }, 600);
  }

  animate();

  // ---------------------------------------------------------------
  // RESIZE
  // ---------------------------------------------------------------
  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

})();
