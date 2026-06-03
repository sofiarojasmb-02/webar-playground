# ANTIGRAVITY AR — WebXR Augmented Reality Playground

An interactive, high-fidelity WebXR Augmented Reality application and desktop simulator designed with modern glassmorphic aesthetics. It allows users to place 3D models onto real-world surfaces (using WebXR) or a virtual floor grid, simulate gravity and elastic bounce physics, deform mesh geometries in real-time, customize material properties, and persist uploaded models.

![Aesthetic Banner](https://images.unsplash.com/photo-1592478411213-6153e4ebc07d?auto=format&fit=crop&w=1200&q=80)

## ✨ Features

- **🔮 WebXR Immersive AR & Simulator:**
  - Full support for immersive WebXR AR session on mobile devices with real-world surface hit-testing.
  - Automatic fallback to a high-fidelity desktop simulator with camera orbital controls and a neon-lit ground grid for non-XR platforms.
- **⚡ Real-time Physics Engine:**
  - Simulated gravity, bounce elasticity (restitution coefficient), and fall height.
  - Automatic settling logic to bring models to a clean rest on the surface.
- **🌀 Dynamic Mesh Vertex Deformer:**
  - Real-time vertex stretching and compression along the Y-axis.
  - Horizontal compensation (X & Z axes scaling) to preserve the object's original volume.
- **🎨 Interactive Material Editor:**
  - Live adjustment of material color, roughness, and metallic characteristics.
- **💾 Local Model Storage (IndexedDB):**
  - Save up to 3 uploaded custom 3D models (.obj, .stl, .glb, .gltf) directly in the browser's IndexedDB for persistent access.
  - Automatic cleanup of older models.

## 🛠️ Technology Stack

- **Core:** HTML5, Vanilla JavaScript (ES6 Modules)
- **Styling:** Premium Glassmorphic CSS (Orbitron & Inter typography, dark mode neon theme)
- **3D Graphics:** Three.js (loaded via HTML5 Import Map)
- **Database:** IndexedDB (Wrapper `db.js`)
- **Hosting Config:** Vercel Static Hosting (`vercel.json`)

## 🚀 How to Run Locally

You can serve this project instantly using any static server. 

```bash
# Serve using http-server
npx -y http-server
```

Or using python:

```bash
python -m http.server
```

Open `http://localhost:8080` in your web browser.

## 📦 Deploying to Vercel

This project is configured out-of-the-box for **Vercel** with clean URLs and custom security headers defined in `vercel.json`.

1. **Push your code to GitHub.**
2. Go to the [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New > Project**.
3. Select this GitHub repository (`webar-playground`).
4. Keep the default settings (Framework Preset: **Other**, Build Command: empty, Output Directory: empty/root).
5. Click **Deploy**.
