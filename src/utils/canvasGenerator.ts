import { RepairSliders } from "../types";

/**
 * Draws procedural graphics on a 2D canvas context simulating a damaged picture,
 * and morphs its features dynamically based on repair sliders.
 * 
 * @param ctx HTML5 Clean Canvas rendering context
 * @param width Canvas logical width
 * @param height Canvas logical height
 * @param type The type of preset (portrait, scenery, vintage, mutation)
 * @param sliders Custom slider values (0-100)
 * @param userTunedRepairRate Master toggle animation rate (0 for damaged, 1 for fully repaired)
 * @param localMaskCanvas Optional underlying drawing canvas containing manual red mask pixels
 */
export function drawProceduralImage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: "portrait" | "scenery" | "vintage" | "mutation",
  sliders: RepairSliders,
  userTunedRepairRate: number = 0,
  localMaskCanvas: HTMLCanvasElement | null = null
) {
  // Clear core canvas
  ctx.clearRect(0, 0, width, height);
  ctx.save();

  // Combine userTunedRepairRate (0 to 1) with specific sliders to gauge repair coefficients
  // If userTunedRepairRate is 1, we default to slider influence or high levels.
  const repairProgress = userTunedRepairRate; 
  
  // Specific sliders from 0 to 1
  const sDeblur = sliders.deblur / 100;
  const sDenoise = sliders.denoise / 100;
  const sFaceRestore = sliders.faceRestore / 100;
  const sColorRec = sliders.colorRecovery / 100;

  // 1. BACKGROUND & LAYOUT DRAW
  if (type === "portrait") {
    // Elegant studio portrait look
    const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width);
    // Bad color: distorted purple-green tint. Good color: soft slate studio grey-blue.
    const badColorStart = "rgba(43, 24, 76, 1)";
    const badColorEnd = "rgba(10, 24, 18, 1)";
    const goodColorStart = "rgba(50, 70, 95, 1)";
    const goodColorEnd = "rgba(15, 23, 42, 1)";

    // Interpolate bg colors
    const rStart = Math.round(43 + (50 - 43) * sColorRec);
    const gStart = Math.round(24 + (70 - 24) * sColorRec);
    const bStart = Math.round(76 + (95 - 76) * sColorRec);
    const rEnd = Math.round(10 + (15 - 10) * sColorRec);
    const gEnd = Math.round(24 + (23 - 24) * sColorRec);
    const bEnd = Math.round(18 + (42 - 18) * sColorRec);

    bgGrad.addColorStop(0, `rgb(${rStart}, ${gStart}, ${bStart})`);
    bgGrad.addColorStop(1, `rgb(${rEnd}, ${gEnd}, ${bEnd})`);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Draw grid of JPEG artifacts (distorted blocks) if denoise slider is low
    const denoiseFactor = Math.max(repairProgress, sDenoise);
    if (denoiseFactor < 0.7) {
      const artifactStrength = (1 - denoiseFactor) * 25;
      ctx.fillStyle = "rgba(128, 0, 128, 0.08)";
      for (let x = 0; x < width; x += 16) {
        for (let y = 0; y < height; y += 16) {
          if ((x + y) % 3 === 0) {
            ctx.fillRect(x, y, 15, 15);
          }
        }
      }
    }

    // DRAW PORTRAIT BASE
    const faceCenterX = width / 2;
    const faceCenterY = height / 2 - 10;
    const faceRadius = 90;

    // Draw Hair (back layer) Includes weird spikes if damaged, sleek style if restored
    const faceRestoreFactor = Math.max(repairProgress, sFaceRestore);
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    // Cyberpunk hair outline
    ctx.arc(faceCenterX, faceCenterY - 10, faceRadius + 5, Math.PI, 0);
    ctx.lineTo(faceCenterX + faceRadius + 15, faceCenterY + 80);
    // If damaged, make hair messy and spiked
    if (faceRestoreFactor < 0.5) {
      const spikes = 10;
      for (let i = 0; i < spikes; i++) {
        const theta = (Math.PI / spikes) * i;
        const offset = Math.sin(i * 3) * 15;
        ctx.lineTo(faceCenterX + Math.cos(theta) * (faceRadius + offset), faceCenterY + Math.sin(theta) * (faceRadius + offset));
      }
    }
    ctx.lineTo(faceCenterX - faceRadius - 15, faceCenterY + 80);
    ctx.closePath();
    ctx.fill();

    // Draw Face Oval (animated/morphed profile)
    ctx.fillStyle = "#fbcfe8"; // healthy base skin tone
    ctx.strokeStyle = "#db2777";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(faceCenterX, faceCenterY, faceRadius, 0, Math.PI * 2);
    ctx.fill();

    // DRAW EYES (This is the CORE "corruption" - mutated coordinates vs restored perfectly symmetrical eyes!)
    // If damaged: Left eye is distorted downwards, colored purple, right eye is tiny/melted.
    // If repaired: High precision beautiful eyes.
    const eyeY_Left_Bad = faceCenterY + 15;
    const eyeY_Left_Good = faceCenterY - 15;
    const eyeY_Right_Bad = faceCenterY - 30;
    const eyeY_Right_Good = faceCenterY - 15;

    const eyeL_Y = eyeY_Left_Bad + (eyeY_Left_Good - eyeY_Left_Bad) * faceRestoreFactor;
    const eyeR_Y = eyeY_Right_Bad + (eyeY_Right_Good - eyeY_Right_Bad) * faceRestoreFactor;

    // Left Eye
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    // Shaking size
    const eyeSizeFactor = 0.5 + faceRestoreFactor * 0.5;
    ctx.ellipse(faceCenterX - 35, eyeL_Y, 20 * eyeSizeFactor, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupil
    const pupilColor = faceRestoreFactor > 0.5 ? "#2563eb" : "#800080"; // blue vs weird distorted magenta
    ctx.fillStyle = pupilColor;
    ctx.beginPath();
    ctx.arc(faceCenterX - 35, eyeL_Y, 8 * eyeSizeFactor, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right Eye (Distorted, melted, or sleek)
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(faceCenterX + 35, eyeR_Y, 20 * eyeSizeFactor, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupil
    ctx.fillStyle = pupilColor;
    ctx.beginPath();
    ctx.arc(faceCenterX + 35, eyeR_Y, 8 * eyeSizeFactor, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // DRAW NOSE && MOUTH
    // Damaged mouth is weird and angled. Clean mouth is a beautiful happy arc.
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(faceCenterX, faceCenterY - 10);
    ctx.lineTo(faceCenterX - 5 * (1 - faceRestoreFactor), faceCenterY + 10);
    ctx.stroke();

    // Mouth
    ctx.save();
    ctx.strokeStyle = "#e11d48"; // pink lips
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (faceRestoreFactor < 0.5) {
      // Crooked diagonal frown/gasp
      ctx.moveTo(faceCenterX - 25, faceCenterY + 45);
      ctx.quadraticCurveTo(faceCenterX - 10, faceCenterY + 25, faceCenterX + 20, faceCenterY + 55);
    } else {
      // Elegant soft smile
      ctx.moveTo(faceCenterX - 25, faceCenterY + 35);
      ctx.quadraticCurveTo(faceCenterX, faceCenterY + 52, faceCenterX + 25, faceCenterY + 35);
    }
    ctx.stroke();
    ctx.restore();

    // GLOW EFFECT (Double blur / Sharpen simulated)
    const deblurFactor = Math.max(repairProgress, sDeblur);
    if (deblurFactor < 0.4) {
      // Draw blurry glow overlay to simulate "bad blur"
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(faceCenterX, faceCenterY, faceRadius + 10, 0, Math.PI * 2);
      ctx.fill();
    }

  } else if (type === "scenery") {
    // Landscape Scenery Preset
    // Ambient light gradients
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    
    // Low color recovery -> bad washed-out yellow-green cast. Good -> rich dawn sunset gradient
    const sColorFactor = Math.max(repairProgress, sColorRec);
    const rStart = Math.round(180 + (251 - 180) * sColorFactor);
    const gStart = Math.round(180 + (113 - 180) * sColorFactor);
    const bStart = Math.round(100 + (133 - 100) * sColorFactor);
    
    skyGrad.addColorStop(0, `rgb(${rStart}, ${gStart}, ${bStart})`); // sunset orange/pink
    skyGrad.addColorStop(0.6, `rgb(${Math.round(220 - 100 * sColorFactor)}, ${Math.round(100 + 40 * sColorFactor)}, ${Math.round(150 + 50 * sColorFactor)})`);
    skyGrad.addColorStop(1, "#1e1b4b"); // deep indigo
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Dynamic Setting Sun
    ctx.fillStyle = `rgba(254, 240, 138, ${0.4 + 0.6 * sColorFactor})`;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 + 10, 70, 0, Math.PI * 2);
    ctx.fill();

    // Mountains with different layers (fuzzy/blurred vs razor-sharp depending on Deblur)
    const deblurFactor = Math.max(repairProgress, sDeblur);
    
    // Draw mountain silhouettes
    ctx.fillStyle = "#312e81";
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width * 0.25, height * 0.45);
    ctx.lineTo(width * 0.55, height * 0.65);
    ctx.lineTo(width * 0.8, height * 0.35);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    // Foreground mountain ridge
    ctx.fillStyle = "#1e1b4b";
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width * 0.4, height * 0.6);
    ctx.lineTo(width * 0.75, height * 0.75);
    ctx.lineTo(width, height * 0.55);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    // Simulated camera lens haze if deblur is extremely low
    if (deblurFactor < 0.5) {
      ctx.fillStyle = `rgba(255,255,255, ${(1 - deblurFactor) * 0.35})`;
      ctx.fillRect(0, 0, width, height);
    }

  } else if (type === "vintage") {
    // Old Antique Building / Architecture Visuals
    const vintageGrad = ctx.createLinearGradient(0, 0, width, height);
    
    // If color recovery is low, we have a muddy, highly oxidized yellowed paper tone.
    // If high, we restore rich, deep contrast vintage brown and highlight details.
    const colorFactor = Math.max(repairProgress, sColorRec);
    const paperTone = `rgb(${Math.round(160 + 40 * colorFactor)}, ${Math.round(130 + 50 * colorFactor)}, ${Math.round(80 + 70 * colorFactor)})`;
    ctx.fillStyle = paperTone;
    ctx.fillRect(0, 0, width, height);

    // Draw Column Pillars (gothic/roman columns)
    ctx.fillStyle = "rgba(43, 24, 10, 0.45)";
    ctx.fillRect(width * 0.15, height * 0.15, 45, height * 0.7);
    ctx.fillRect(width * 0.75, height * 0.15, 45, height * 0.7);

    // Column Base and Caps
    ctx.fillStyle = "rgba(30, 15, 5, 0.6)";
    // Bases
    ctx.fillRect(width * 0.12, height * 0.85, 60, 20);
    ctx.fillRect(width * 0.72, height * 0.85, 60, 20);
    // Caps
    ctx.fillRect(width * 0.12, height * 0.1, 60, 20);
    ctx.fillRect(width * 0.72, height * 0.1, 60, 20);

    // Central ancient warm light lantern/arched gate
    ctx.strokeStyle = "rgba(20, 10, 0, 0.7)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 + 20, 50, Math.PI, 0, false);
    ctx.lineTo(width / 2 + 50, height * 0.85);
    ctx.lineTo(width / 2 - 50, height * 0.85);
    ctx.closePath();
    ctx.stroke();

    // Warm inner light glow
    const sColorRecovery = Math.max(repairProgress, sColorRec);
    ctx.fillStyle = `rgba(251, 191, 36, ${0.15 + sColorRecovery * 0.5})`;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 + 40, 40, 0, Math.PI * 2);
    ctx.fill();

    // BLUR / DUST NOISE OVERLAY
    const deblurFactor = Math.max(repairProgress, sDeblur);
    if (deblurFactor < 0.6) {
      // Simulate micro dust spots on vintage lens
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      ctx.beginPath();
      // Draw 8 random dust circles
      ctx.arc(width * 0.2, height * 0.3, 3, 0, Math.PI * 2);
      ctx.arc(width * 0.85, height * 0.5, 4, 0, Math.PI * 2);
      ctx.arc(width * 0.45, height * 0.25, 2, 0, Math.PI * 2);
      ctx.arc(width * 0.6, height * 0.75, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // SCARS AND CRACKS OVERLAY (The core visual damage in classical photo)
    // If denoise / userTunedRepairRate is low, we render big jagged white scratch marks.
    const scratchFactor = Math.max(repairProgress, sDenoise);
    if (scratchFactor < 0.85) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"; // White paint scratch
      ctx.lineWidth = 3 * (1 - scratchFactor);
      ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
      ctx.shadowBlur = 2;
      ctx.lineCap = "round";
      
      // Scratch 1
      ctx.beginPath();
      ctx.moveTo(width * 0.35, height * 0.1);
      ctx.lineTo(width * 0.32, height * 0.4);
      ctx.lineTo(width * 0.38, height * 0.6);
      ctx.lineTo(width * 0.34, height * 0.9);
      ctx.stroke();

      // Scratch 2 (shorter branch)
      ctx.beginPath();
      ctx.moveTo(width * 0.68, height * 0.2);
      ctx.lineTo(width * 0.73, height * 0.45);
      ctx.lineTo(width * 0.65, height * 0.75);
      ctx.stroke();
      
      ctx.restore();
    }

  } else if (type === "mutation") {
    // AI Anatomy Mutation: Generates custom cyber hand and mechanical alignment
    // Dark terminal canvas
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // Glowing electronic background lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(99, 102, 241, 0.12)";
    for (let i = 0; i < width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    // DRAW AI WRIST & PALM
    const wristX = width / 2;
    const wristY = height - 40;
    const palmX = width / 2;
    const palmY = height / 2 + 30;

    const faceRestoreFactor = Math.max(repairProgress, sFaceRestore);

    // Cyber Wrist
    ctx.fillStyle = "#334155";
    ctx.fillRect(wristX - 25, wristY, 50, 45);
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 2;
    ctx.strokeRect(wristX - 25, wristY, 50, 45);

    // Draw Palm block
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(wristX - 30, wristY);
    ctx.lineTo(palmX - 35, palmY);
    ctx.lineTo(palmX + 35, palmY);
    ctx.lineTo(wristX + 30, wristY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // DRAW FINGERS (Anatomical Mutation: 7 chaotic fingers if bad, morphs into 5 perfect fingers)
    // We define a map of finger joint angles. We interpolate vectors seamlessly!
    ctx.strokeStyle = faceRestoreFactor < 0.5 ? "#f43f5e" : "#10b981"; // toxic red vs eco green
    ctx.lineWidth = 4;
    ctx.lineCap = "round";

    if (faceRestoreFactor < 0.5) {
      // 7 chaotic fingers!
      const fingerAngles = [-2.4, -2.1, -1.8, -1.5, -1.2, -0.9, -0.6];
      const fingerLengths = [50, 75, 80, 85, 78, 70, 45];
      
      fingerAngles.forEach((angle, idx) => {
        const length = fingerLengths[idx];
        const startX = palmX - 25 + idx * 8;
        const startY = palmY;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        // Joint 1
        const midX = startX + Math.cos(angle) * (length * 0.5);
        const midY = startY + Math.sin(angle) * (length * 0.5);
        ctx.lineTo(midX, midY);
        // Joint 2 (mutated curve angle shaking slightly)
        const jitterAngle = angle + Math.sin(idx * 4) * 0.4 * (1 - faceRestoreFactor);
        const endX = midX + Math.cos(jitterAngle) * (length * 0.5);
        const endY = midY + Math.sin(jitterAngle) * (length * 0.5);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Glowing red joint dots
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(endX, endY, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // Clean 5 human fingers correctly proportioned!
      const fingerAngles = [-2.3, -1.9, -1.5, -1.1, -0.7];
      const fingerLengths = [55, 80, 95, 85, 60];
      
      fingerAngles.forEach((angle, idx) => {
        const length = fingerLengths[idx];
        const startX = palmX - 25 + idx * 12;
        const startY = palmY;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        // Joint 1
        const midX = startX + Math.cos(angle) * (length * 0.5);
        const midY = startY + Math.sin(angle) * (length * 0.5);
        ctx.lineTo(midX, midY);
        // Joint 2
        const endX = midX + Math.cos(angle) * (length * 0.5);
        const endY = midY + Math.sin(angle) * (length * 0.5);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Clean micro green trackers
        ctx.fillStyle = "#34d399";
        ctx.beginPath();
        ctx.arc(endX, endY, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 2. NOISE LAYER (Simulates grainy sensor / high-frequency noise if Denoise is low)
  const denoiseFactor = Math.max(repairProgress, sDenoise);
  if (denoiseFactor < 0.95) {
    const rawData = ctx.getImageData(0, 0, width, height);
    const data = rawData.data;
    // Strength of noise is inversely proportional to Denoise slider
    const noiseStrength = Math.round((1 - denoiseFactor) * 85);
    
    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < 0.35) {
        const noise = (Math.random() - 0.5) * noiseStrength;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));     // R
        data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise)); // G
        data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise)); // B
      }
    }
    ctx.putImageData(rawData, 0, 0);
  }

  // 3. COLOR DISPERSION & ARTIFACT FILTER (Blur application simulation)
  const deblurFactor = Math.max(repairProgress, sDeblur);
  if (deblurFactor < 0.95) {
    const rawData_B = ctx.getImageData(0, 0, width, height);
    // Simple 1D horizontal blur overlay
    const data_B = rawData_B.data;
    const blurPixelDist = Math.round((1 - deblurFactor) * 8);
    
    if (blurPixelDist > 0) {
      for (let y = 0; y < height; y++) {
        for (let x = blurPixelDist; x < width - blurPixelDist; x++) {
          const idx = (y * width + x) * 4;
          const idxPrev = (y * width + (x - blurPixelDist)) * 4;
          const idxNext = (y * width + (x + blurPixelDist)) * 4;

          // Merge RGB channels
          data_B[idx] = (data_B[idxPrev] + data_B[idx] + data_B[idxNext]) / 3;
          data_B[idx+1] = (data_B[idxPrev+1] + data_B[idx+1] + data_B[idxNext+1]) / 3;
          data_B[idx+2] = (data_B[idxPrev+2] + data_B[idx+2] + data_B[idxNext+2]) / 3;
        }
      }
      ctx.putImageData(rawData_B, 0, 0);
    }
  }

  // 4. APPLY USER-DRAWN MANUAL MASKS HEALING (局部手动修复)
  // If a manual mask canvas exists, and user has painted some pixels, we erase those painted pixels in the damage layer
  // or apply local smoothing/sharpening onto it.
  if (localMaskCanvas && userTunedRepairRate > 0) {
    // Render masked parts with higher clarity or blended filters
    const maskCtx = localMaskCanvas.getContext("2d");
    if (maskCtx) {
      const maskData = maskCtx.getImageData(0, 0, width, height);
      const canvasData = ctx.getImageData(0, 0, width, height);
      const mD = maskData.data;
      const cD = canvasData.data;

      // Scan through pixels. If a pixel has mask color (alpha > 0), we push it towards the "fully repaired" version
      for (let i = 0; i < mD.length; i += 4) {
        if (mD[i + 3] > 10) {
          // This represents manual inpainting / detail healing!
          // Blend with perfect values (higher contrast, crisp lines, cleared white scars)
          // We can soften noise specifically inside this masked region
          cD[i] = Math.min(255, Math.round(cD[i] * 1.1));     // Local brighten
          cD[i+1] = Math.min(255, Math.round(cD[i+1] * 1.15)); // Local saturation boost
          cD[i+2] = Math.round(cD[i+2] * 0.95);               // Filter yellow tints
        }
      }
      ctx.putImageData(canvasData, 0, 0);
    }
  }

  ctx.restore();
}
