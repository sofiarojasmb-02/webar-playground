/**
 * app.js - Orchestrator Principal de la Aplicación Web AR
 * Inicializa Three.js, gestiona WebXR (Hit Test) o el simulador de escritorio,
 * maneja los cargadores de modelos 3D y conecta la interfaz de usuario con físicas y deformación.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

class WebARApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = new THREE.Clock();

        // Cargadores
        this.gltfLoader = new GLTFLoader();
        this.objLoader = new OBJLoader();
        this.stlLoader = new STLLoader();

        // Módulos
        this.physics = new PhysicsEngine();
        this.deformer = new MeshDeformer();

        // Modelos
        this.activeModel = null;        // El modelo actualmente seleccionado (plantilla)
        this.placedModel = null;        // La instancia colocada en la escena
        this.reticle = null;            // Retícula indicadora en AR/Simulador
        this.gridHelper = null;         // Rejilla del simulador
        this.shadowPlane = null;        // Plano receptor de sombras para el simulador

        // WebXR Hit Test
        this.xrSession = null;
        this.hitTestSource = null;
        this.localRefSpace = null;

        // Modo de AR detectado: 'webxr' (Android/WebXR Viewer), 'quicklook' (iOS Safari/Chrome) o 'none'
        this.arMode = 'none';
        // Contador de frames consecutivos sin resultados de hit-test (para fallback en WebXR Viewer iOS)
        this.noHitFrames = 0;

        // UI State
        this.activeModelId = 'preset_cube'; // ID del modelo seleccionado
        this.currentColor = '#8b5cf6';      // Color activo (Morado Eléctrico)
        this.currentDeformation = 1.0;      // 1.0 = original
        this.roughness = 0.4;
        this.metalness = 0.8;

        // Raycasting para simulador
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isPointerDown = false;
        this.pointerDownTime = 0;

        // Variables para gestos y control táctil interactivo
        this.activePointers = {};
        this.prevPinchDist = 0;
        this.isPinching = false;
        this.isDragging = false;
        this.dragPlane = new THREE.Plane();
        this.dragOffset = new THREE.Vector3();
        this.lastTapTime = 0;
        this.isDoubleTap = false;
        this.squashAmount = 0.0;
        this.squashTimer = 0.0;
        this.arModelPlaced = false;
        this.lastTouchX = 0;
        this.lastTouchY = 0;
        this.lastValidReticlePosition = null;
        this.lastValidReticleRotation = null;

        // Video AR y giroscopio (híbrido iOS Safari)
        this.videoArActive = false;
        this.videoStream = null;
        this.gyroActive = false;
        this.initialOrientation = null;
        this.initialCameraQuaternion = null;
        this.handleDeviceOrientationBound = null;

        // Físicas de inflado y material
        this.inflateAmount = 0.0;
        this.inflateTimer = 0.0;
        this.currentMaterialType = 'solid';

        // Objetos de apoyo visual para los 12 principios de animación
        this.stagingLight = null;
        this.rippleMesh = null;
        this.particleSystem = null;
        this.ghostMeshes = [];
        this.boxHelper = null;
        this.vectorArrow = null;
        this.dimensionLabels = null;
        this.lastPosition = new THREE.Vector3();
        this.horizontalVelocity = new THREE.Vector3();
        this.cameraShakeTime = 0.0;
        this.cameraShakeIntensity = 0.0;
        this.appealSpinTime = 0.0;
    }

    /**
     * Inicializa la aplicación
     */
    async init() {
        this.setupThree();
        this.setupLights();
        this.createReticle();
        this.setupSimulator();
        this.setupUIEvents();
        this.setupWebXRAvailability();
        this.loadRecentGallery();
        
        // Inicializar auxiliares visuales de los 12 principios
        this.setupAnimationPrinciplesHelpers();

        // Configurar colisión en físicas para squash elástico (efecto gelatina) y efectos secundarios
        this.physics.onCollision = (impactVelocity) => {
            if (!isNaN(impactVelocity) && isFinite(impactVelocity)) {
                // 1. Squash & Stretch: amortiguar escala
                if (this.physics.principles.squashStretch) {
                    this.squashAmount = Math.min(0.6, impactVelocity * 0.06) * this.physics.exaggeration;
                    this.squashTimer = 0.0;
                }
                
                // 3. Staging: Sacudida de cámara
                if (this.physics.principles.staging && impactVelocity > 1.5) {
                    this.cameraShakeIntensity = Math.min(0.12, impactVelocity * 0.015) * this.physics.exaggeration;
                    this.cameraShakeTime = 0.22;
                }
                
                // 8. Secondary Action: Partículas y onda expansiva
                if (this.physics.principles.secondaryAction && this.placedModel) {
                    this.triggerSecondaryActionEffects(this.placedModel.position.clone(), impactVelocity);
                }
            }
        };

        // Configurar inicio de salto para Poses Fantasma
        this.physics.onJumpStart = () => {
            if (this.physics.motionMode === 'pose' && this.physics.principles.poseGhosts && this.placedModel) {
                this.spawnGhostMeshes();
            }
            if (this.physics.principles.appeal) {
                this.appealSpinTime = 0.45; // Giro sutil al despegar
            }
        };

        // Cargar modelo predeterminado por defecto
        this.selectPreset('cube');

        // Bucle de renderizado
        this.renderer.setAnimationLoop((time, frame) => this.render(time, frame));

        window.addEventListener('resize', () => this.onWindowResize());

        // Guardar coordenadas de la última posición tocada en pantalla para raycasting en AR
        window.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                this.lastTouchX = e.touches[0].clientX;
                this.lastTouchY = e.touches[0].clientY;
            }
        }, { passive: true });
    }

    /**
     * Configuración del motor 3D Three.js
     */
    setupThree() {
        this.scene = new THREE.Scene();
        // Neblina azulada tecnológica de fondo
        this.scene.fog = new THREE.FogExp2(0x050515, 0.05);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20);
        this.camera.position.set(0, 1.6, 2.5); // Altura de ojo humano promedio

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.xr.enabled = true;

        this.container.appendChild(this.renderer.domElement);

        // Controles de cámara en escritorio
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // No pasar bajo el suelo
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 10;
        this.controls.target.set(0, 0.5, 0);
    }

    /**
     * Iluminación de la escena
     */
    setupLights() {
        // Luz de ambiente para iluminación base uniforme en AR (evita modelos oscuros)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
        this.scene.add(ambientLight);

        // Luz hemisférica con tonos morados (cielo) y azules (suelo)
        const hemiLight = new THREE.HemisphereLight(0xa855f7, 0x06b6d4, 0.6);
        hemiLight.position.set(0, 5, 0);
        this.scene.add(hemiLight);

        // Luz direccional tecnológica con sombras
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(2, 4, 2);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 10;
        dirLight.shadow.camera.left = -2;
        dirLight.shadow.camera.right = 2;
        dirLight.shadow.camera.top = 2;
        dirLight.shadow.camera.bottom = -2;
        dirLight.shadow.bias = -0.0005;
        this.scene.add(dirLight);

        // Luz puntual de acento neón
        const pointLight = new THREE.PointLight(0x8b5cf6, 1, 5);
        pointLight.position.set(-1.5, 1, -1);
        this.scene.add(pointLight);
    }

    /**
     * Creación de la retícula de colocación (Aro de neón brillante)
     */
    createReticle() {
        const ringGeo = new THREE.RingGeometry(0.12, 0.15, 32);
        ringGeo.rotateX(-Math.PI / 2); // Alinear plano al suelo

        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x06b6d4,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        });

        // Crear una cruz interna minimalista para mayor precisión visual
        const reticleGroup = new THREE.Group();
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        reticleGroup.add(ringMesh);

        // Cruz
        const lineMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.6 });
        const crossGeo1 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.06, 0, 0), new THREE.Vector3(0.06, 0, 0)]);
        const crossGeo2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.06), new THREE.Vector3(0, 0, 0.06)]);
        const line1 = new THREE.Line(crossGeo1, lineMat);
        const line2 = new THREE.Line(crossGeo2, lineMat);
        reticleGroup.add(line1, line2);

        reticleGroup.visible = false;
        reticleGroup.matrixAutoUpdate = false; // Controlado por WebXR Hit Test o Raycast
        this.scene.add(reticleGroup);
        this.reticle = reticleGroup;
    }

    /**
     * Configuración de la cuadrícula de suelo y plano de sombra para el Simulador de Escritorio
     */
    setupSimulator() {
        // Rejilla neón cian
        this.gridHelper = new THREE.GridHelper(10, 20, 0x8b5cf6, 0x0d0e2d);
        this.gridHelper.position.y = -0.001; // Justo debajo del plano cero para evitar z-fighting
        this.gridHelper.material.opacity = 0.25;
        this.gridHelper.material.transparent = true;
        this.scene.add(this.gridHelper);

        // Plano invisible que recibe sombras proyectadas
        const planeGeo = new THREE.PlaneGeometry(20, 20);
        planeGeo.rotateX(-Math.PI / 2);
        const planeMat = new THREE.ShadowMaterial({ opacity: 0.4 });
        this.shadowPlane = new THREE.Mesh(planeGeo, planeMat);
        this.shadowPlane.receiveShadow = true;
        this.scene.add(this.shadowPlane);
    }

    /**
     * Comprueba disponibilidad de WebXR AR
     */
    setupWebXRAvailability() {
        const arButton = document.getElementById('ar-toggle');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
                if (supported) {
                    this.arMode = 'webxr';
                    statusDot.className = 'status-dot active';
                    statusText.textContent = 'AR WebXR Disponible';
                    arButton.style.display = 'flex';
                } else {
                    this.trySetupQuickLook();
                }
            }).catch(() => {
                this.trySetupQuickLook();
            });
        } else {
            this.trySetupQuickLook();
        }
    }

    /**
     * Fallback de AR para iOS Safari/Chrome (donde WebXR immersive-ar no existe).
     * Detecta soporte de AR Quick Look y, de existir, habilita el botón AR en modo Quick Look.
     */
    trySetupQuickLook() {
        const arButton = document.getElementById('ar-toggle');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        // Detectar iOS (incluye iPadOS que se reporta como MacIntel con pantalla táctil)
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Detectar soporte nativo de AR Quick Look (anchor rel="ar")
        const anchor = document.createElement('a');
        const quickLookSupported = isIOS && anchor.relList && anchor.relList.supports &&
            anchor.relList.supports('ar');

        if (quickLookSupported) {
            this.arMode = 'quicklook';
            statusDot.className = 'status-dot active';
            statusText.textContent = 'AR Quick Look (iOS)';
            arButton.style.display = 'flex';
            this.showToast('AR nativo de iOS disponible (Quick Look).', 'info');
        } else {
            this.arMode = 'none';
            this.setSimulatorStatus();
        }
    }

    setSimulatorStatus() {
        const arButton = document.getElementById('ar-toggle');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        statusDot.className = 'status-dot warning';
        statusText.textContent = 'Simulador de Escritorio';
        arButton.style.display = 'none'; // Ocultar botón AR real
        this.showToast('WebXR AR no soportado. Iniciando en modo Simulador 3D.', 'info');
    }

    /**
     * Inicializa eventos de interfaz (sliders, menú inferior, botones)
     */
    setupUIEvents() {
        const drawer = document.getElementById('control-drawer');
        const handle = document.getElementById('drawer-handle');

        // Toggle del Menú Inferior (deslizar)
        handle.addEventListener('click', () => {
            drawer.classList.toggle('collapsed');
        });

        // Evitar que la rotación de cámara interfiera al arrastrar los controles del drawer
        drawer.addEventListener('pointerdown', (e) => e.stopPropagation());

        // Eventos para Físicas y Rebote
        const sliderGravity = document.getElementById('slider-gravity');
        const valGravity = document.getElementById('val-gravity');
        sliderGravity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valGravity.textContent = `${val.toFixed(1)} m/s²`;
            this.physics.gravity = val;
        });

        const sliderElasticity = document.getElementById('slider-elasticity');
        const valElasticity = document.getElementById('val-elasticity');
        sliderElasticity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valElasticity.textContent = `${(val * 100).toFixed(0)}%`;
            this.physics.elasticity = val;
        });

        const sliderHeight = document.getElementById('slider-height');
        const valHeight = document.getElementById('val-height');
        sliderHeight.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valHeight.textContent = `${val.toFixed(1)} m`;
            this.physics.dropHeight = val;
        });

        const sliderMass = document.getElementById('slider-mass');
        const valMass = document.getElementById('val-mass');
        sliderMass.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valMass.textContent = `${val.toFixed(1)} kg`;
            this.physics.mass = val;
        });

        const sliderFriction = document.getElementById('slider-friction');
        const valFriction = document.getElementById('val-friction');
        sliderFriction.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valFriction.textContent = val.toFixed(1);
            this.physics.friction = val;
        });

        const btnDrop = document.getElementById('btn-drop');
        btnDrop.addEventListener('click', () => {
            this.triggerBounceDrop();
        });

        // Eventos para Deformación
        const sliderDeform = document.getElementById('slider-deform');
        const valDeform = document.getElementById('val-deform');
        sliderDeform.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const percent = ((val - 1.0) * 100).toFixed(0);
            valDeform.textContent = val >= 1.0 ? `+${percent}% (Estirar)` : `${percent}% (Comprimir)`;
            this.currentDeformation = val;
            this.updateDeformation();
        });

        // Eventos para Estilizado y Color
        const colorInput = document.getElementById('color-picker');
        const updateColorFn = (color) => {
            this.currentColor = color;
            this.updateColor();
            // Desactivar estado activo visual de chips
            document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
        };
        colorInput.addEventListener('input', (e) => updateColorFn(e.target.value));
        colorInput.addEventListener('change', (e) => updateColorFn(e.target.value));

        // Eventos de chips rápidos de color
        document.querySelectorAll('.color-chip').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                const color = chip.getAttribute('data-color');
                this.currentColor = color;
                colorInput.value = color;
                document.getElementById('color-dot-container').style.backgroundColor = color;
                this.updateColor();

                document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });

        const sliderRoughness = document.getElementById('slider-roughness');
        const valRoughness = document.getElementById('val-roughness');
        sliderRoughness.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valRoughness.textContent = `${(val * 100).toFixed(0)}%`;
            this.roughness = val;
            this.updateMaterialProperties();
        });

        const sliderMetalness = document.getElementById('slider-metalness');
        const valMetalness = document.getElementById('val-metalness');
        sliderMetalness.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            valMetalness.textContent = `${(val * 100).toFixed(0)}%`;
            this.metalness = val;
            this.updateMaterialProperties();
        });

        // Selector de tipo de material
        const selectMaterialType = document.getElementById('select-material-type');
        if (selectMaterialType) {
            selectMaterialType.addEventListener('change', (e) => {
                const type = e.target.value;
                this.currentMaterialType = type;
                
                // Actualizar sliders con los valores preestablecidos
                const sRoughness = document.getElementById('slider-roughness');
                const vRoughness = document.getElementById('val-roughness');
                const sMetalness = document.getElementById('slider-metalness');
                const vMetalness = document.getElementById('val-metalness');
                
                if (type === 'glass') {
                    this.roughness = 0.1;
                    this.metalness = 0.1;
                } else if (type === 'aluminum') {
                    this.roughness = 0.2;
                    this.metalness = 0.9;
                } else if (type === 'wood') {
                    this.roughness = 0.8;
                    this.metalness = 0.0;
                } else if (type === 'ceramic') {
                    this.roughness = 0.95;
                    this.metalness = 0.0;
                } else {
                    // solid / estándar
                    this.roughness = 0.4;
                    this.metalness = 0.8;
                }
                
                if (sRoughness) sRoughness.value = this.roughness;
                if (vRoughness) vRoughness.textContent = `${(this.roughness * 100).toFixed(0)}%`;
                if (sMetalness) sMetalness.value = this.metalness;
                if (vMetalness) vMetalness.textContent = `${(this.metalness * 100).toFixed(0)}%`;
                
                this.updateMaterialType();
            });
        }

        // Evento de Carga de Archivo Local
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleFileUpload(file);
        });

        // Drag and drop para archivos
        const uploadZone = document.getElementById('upload-zone');
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.handleFileUpload(file);
        });

        // Botón WebXR AR
        const arButton = document.getElementById('ar-toggle');
        arButton.addEventListener('click', () => {
            if (this.arMode === 'quicklook') {
                const modal = document.getElementById('ar-selector-modal');
                if (modal) modal.classList.add('show');
            } else {
                this.toggleXRSession();
            }
        });

        // Botones del Modal Selector AR
        const btnArInteractive = document.getElementById('btn-ar-interactive');
        if (btnArInteractive) {
            btnArInteractive.addEventListener('click', () => {
                const modal = document.getElementById('ar-selector-modal');
                if (modal) modal.classList.remove('show');
                this.startVideoAR();
            });
        }

        const btnArQuicklook = document.getElementById('btn-ar-quicklook');
        if (btnArQuicklook) {
            btnArQuicklook.addEventListener('click', () => {
                const modal = document.getElementById('ar-selector-modal');
                if (modal) modal.classList.remove('show');
                this.launchQuickLook();
            });
        }

        const btnArCancel = document.getElementById('btn-ar-cancel');
        if (btnArCancel) {
            btnArCancel.addEventListener('click', () => {
                const modal = document.getElementById('ar-selector-modal');
                if (modal) modal.classList.remove('show');
            });
        }

        // Botón para salir del modo Video AR
        const btnExitVideoAr = document.getElementById('btn-exit-video-ar');
        if (btnExitVideoAr) {
            btnExitVideoAr.addEventListener('click', () => {
                this.stopVideoAR();
            });
        }

        // Botón de Ajustes en AR
        const settingsToggle = document.getElementById('settings-toggle');
        if (settingsToggle) {
            settingsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                drawer.classList.toggle('ar-visible');
            });
        }

        // Los eventos de ratón/táctil sobre el lienzo se manejan de manera unificada en setupTouchInteractions()

        // Eventos de selección de galería (se enlazan dinámicamente, excepto presets)
        document.querySelectorAll('.gallery-item[data-preset]').forEach((item) => {
            item.addEventListener('click', () => {
                const presetName = item.getAttribute('data-preset');
                this.selectPreset(presetName);
                
                // Actualizar UI activa
                document.querySelectorAll('.gallery-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // --- BINDINGS PARA 12 PRINCIPIOS DE ANIMACIÓN ---
        // 1. Selector de Pestañas (Tabs)
        const tabStandard = document.getElementById('tab-btn-standard');
        const tabPrinciples = document.getElementById('tab-btn-principles');
        const panelStandard = document.getElementById('panel-standard');
        const panelPrinciples = document.getElementById('panel-principles');

        if (tabStandard && tabPrinciples && panelStandard && panelPrinciples) {
            tabStandard.addEventListener('click', (e) => {
                e.stopPropagation();
                tabStandard.classList.add('active');
                tabPrinciples.classList.remove('active');
                panelStandard.classList.add('active');
                panelStandard.style.display = 'block';
                panelPrinciples.classList.remove('active');
                panelPrinciples.style.display = 'none';
            });

            tabPrinciples.addEventListener('click', (e) => {
                e.stopPropagation();
                tabPrinciples.classList.add('active');
                tabStandard.classList.remove('active');
                panelPrinciples.classList.add('active');
                panelPrinciples.style.display = 'block';
                panelStandard.classList.remove('active');
                panelStandard.style.display = 'none';
            });
        }

        // 2. Control de Exageración
        const sliderExaggeration = document.getElementById('slider-exaggeration');
        const valExaggeration = document.getElementById('val-exaggeration');
        if (sliderExaggeration) {
            sliderExaggeration.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (valExaggeration) {
                    valExaggeration.textContent = `${val.toFixed(1)}x ${val === 1.0 ? '(Normal)' : val > 1.0 ? '(Exagerado)' : '(Sutil)'}`;
                }
                this.physics.exaggeration = val;
            });
        }

        // 3. Preset de Timing (Ritmo)
        const selectTimingPreset = document.getElementById('select-timing-preset');
        if (selectTimingPreset) {
            selectTimingPreset.addEventListener('change', (e) => {
                const preset = e.target.value;
                this.physics.applyTimingPreset(preset);

                // Sincronizar sliders originales
                const sGravity = document.getElementById('slider-gravity');
                const vGravity = document.getElementById('val-gravity');
                const sElasticity = document.getElementById('slider-elasticity');
                const vElasticity = document.getElementById('val-elasticity');
                const sFriction = document.getElementById('slider-friction');
                const vFriction = document.getElementById('val-friction');
                const sMass = document.getElementById('slider-mass');
                const vMass = document.getElementById('val-mass');

                if (sGravity) {
                    sGravity.value = this.physics.gravity;
                    if (vGravity) vGravity.textContent = `${this.physics.gravity.toFixed(1)} m/s²`;
                }
                if (sElasticity) {
                    sElasticity.value = this.physics.elasticity;
                    if (vElasticity) vElasticity.textContent = `${(this.physics.elasticity * 100).toFixed(0)}%`;
                }
                if (sFriction) {
                    sFriction.value = this.physics.friction;
                    if (vFriction) vFriction.textContent = this.physics.friction.toFixed(1);
                }
                if (sMass) {
                    sMass.value = this.physics.mass;
                    if (vMass) vMass.textContent = `${this.physics.mass.toFixed(1)} kg`;
                }

                this.showToast(`Timing preset '${preset}' aplicado.`);
            });
        }

        // 4. Modo de Movimiento (Acción Directa vs Pose a Pose)
        const selectMotionMode = document.getElementById('select-motion-mode');
        if (selectMotionMode) {
            selectMotionMode.addEventListener('change', (e) => {
                this.physics.motionMode = e.target.value;
                if (e.target.value === 'pose') {
                    this.showToast('Modo Pose a Pose activo.');
                } else {
                    this.showToast('Modo Acción Directa activo.');
                    this.clearGhostMeshes();
                }
            });
        }

        // 5. Botón Animar
        const btnAnimateTrigger = document.getElementById('btn-animate-trigger');
        if (btnAnimateTrigger) {
            btnAnimateTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.triggerAnimatedJump();
            });
        }

        // 6. Interruptores de Principios individuales
        const principlesMapping = [
            { id: 'check-squash-stretch', prop: 'squashStretch' },
            { id: 'check-anticipation', prop: 'anticipation' },
            { id: 'check-staging', prop: 'staging' },
            { id: 'check-pose-ghosts', prop: 'poseGhosts' },
            { id: 'check-follow-through', prop: 'followThrough' },
            { id: 'check-slow-in-out', prop: 'slowInOut' },
            { id: 'check-arcs', prop: 'arcs' },
            { id: 'check-secondary-action', prop: 'secondaryAction' },
            { id: 'check-timing', prop: 'timing' },
            { id: 'check-exaggeration', prop: 'exaggeration' },
            { id: 'check-solid-drawing', prop: 'solidDrawing' },
            { id: 'check-appeal', prop: 'appeal' }
        ];

        principlesMapping.forEach((item) => {
            const chk = document.getElementById(item.id);
            if (chk) {
                // Sincronizar estado inicial
                chk.checked = this.physics.principles[item.prop];
                chk.addEventListener('change', (e) => {
                    this.physics.principles[item.prop] = e.target.checked;
                    
                    // Efectos inmediatos al desactivar
                    if (item.prop === 'solidDrawing' && !e.target.checked) {
                        if (this.boxHelper) this.boxHelper.visible = false;
                        if (this.vectorArrow) this.vectorArrow.visible = false;
                        if (this.dimensionLabels) this.dimensionLabels.style.opacity = '0';
                    }
                    if (item.prop === 'poseGhosts' && !e.target.checked) {
                        this.clearGhostMeshes();
                    }
                });
            }
        });

        // Inicializar interacciones multitáctiles de físicas y gestos
        this.setupTouchInteractions();
    }

    /**
     * Inicializa las interacciones táctiles avanzadas: Doble toque (salto),
     * Arrastrar y Soltar (drag & drop) con físicas, y Pellizcar (pinch to deform).
     */
    /**
     * Inicializa las interacciones táctiles avanzadas: Doble toque (salto),
     * Arrastrar y Soltar (drag & drop) con físicas, y Pellizcar (pinch to deform).
     * También maneja la colocación unificada y el rebote en clicks simples.
     */
    setupTouchInteractions() {
        const dom = this.renderer.domElement;

        dom.addEventListener('pointerdown', (e) => {
            // Registrar puntero activo
            this.activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };

            const pointerIds = Object.keys(this.activePointers);

            // 1. Gesto de PELLIZCAR (2 dedos)
            if (pointerIds.length === 2) {
                // Cancelar cualquier arrastre de 1 dedo activo
                this.isDragging = false;

                const p1 = this.activePointers[pointerIds[0]];
                const p2 = this.activePointers[pointerIds[1]];
                this.prevPinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                
                // Si al menos un dedo está sobre el modelo, permitimos pellizcar el modelo
                const camera = this.xrSession ? this.renderer.xr.getCamera() : this.camera;
                this.raycaster.setFromCamera(this.mouse, camera);
                const intersects = this.placedModel ? this.raycaster.intersectObject(this.placedModel, true) : [];
                if (intersects.length > 0) {
                    this.isPinching = true;
                    this.controls.enabled = false; // Desactivar rotación de cámara
                    
                    // Colapsar panel para ver mejor el modelo
                    const drawer = document.getElementById('control-drawer');
                    if (drawer && !drawer.classList.contains('collapsed')) {
                        drawer.classList.add('collapsed');
                    }
                }
                return;
            }

            // 2. Gesto de 1 dedo (Doble toque y Arrastrar)
            if (pointerIds.length === 1) {
                this.isDoubleTap = false;
                this.isPointerDown = true;
                this.pointerDownTime = performance.now();
                this.updateMouseCoords(e);
                
                // Comprobar DOBLE TOQUE
                const now = performance.now();
                const timeDiff = now - this.lastTapTime;
                this.lastTapTime = now;

                const camera = this.xrSession ? this.renderer.xr.getCamera() : this.camera;
                this.raycaster.setFromCamera(this.mouse, camera);
                const intersects = this.placedModel ? this.raycaster.intersectObject(this.placedModel, true) : [];

                if (timeDiff < 300 && intersects.length > 0) {
                    // Doble toque en el modelo -> Salto e inflado de físicas elástico
                    this.isDoubleTap = true;
                    this.physics.applyImpulse(6.0); // Impulso hacia arriba (m/s)
                    this.inflateAmount = 0.5;       // Iniciar inflado al 50%
                    this.inflateTimer = 0.0;        // Reiniciar oscilación
                    this.showToast('¡Modelo inflado con rebote elástico!');
                    return;
                }
            }
        });

        dom.addEventListener('pointermove', (e) => {
            if (this.activePointers[e.pointerId]) {
                this.activePointers[e.pointerId].x = e.clientX;
                this.activePointers[e.pointerId].y = e.clientY;
            }

            const pointerIds = Object.keys(this.activePointers);

            // 1. Mover durante PELLIZCO (Deformación)
            if (this.isPinching && pointerIds.length === 2) {
                const p1 = this.activePointers[pointerIds[0]];
                const p2 = this.activePointers[pointerIds[1]];
                const currentDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                
                if (this.prevPinchDist > 0 && !isNaN(this.prevPinchDist)) {
                    const ratio = currentDist / this.prevPinchDist;
                    if (!isNaN(ratio) && isFinite(ratio) && ratio > 0) {
                        this.prevPinchDist = currentDist;
                        
                        // Modificar deformación Y
                        this.currentDeformation = Math.max(0.4, Math.min(2.2, this.currentDeformation * ratio));
                        
                        // Sincronizar el deslizador de la UI
                        const sliderDeform = document.getElementById('slider-deform');
                        const valDeform = document.getElementById('val-deform');
                        if (sliderDeform) sliderDeform.value = this.currentDeformation;
                        if (valDeform) {
                            const percent = ((this.currentDeformation - 1.0) * 100).toFixed(0);
                            valDeform.textContent = this.currentDeformation >= 1.0 ? `+${percent}% (Estirar)` : `${percent}% (Comprimir)`;
                        }
                    }
                } else {
                    this.prevPinchDist = currentDist;
                }
                return;
            }

            // Código de movimiento de arrastre eliminado.
        });

        const onPointerUp = (e) => {
            const clickDuration = this.isPointerDown ? (performance.now() - this.pointerDownTime) : 1000;
            this.isPointerDown = false;

            delete this.activePointers[e.pointerId];
            const pointerIds = Object.keys(this.activePointers);

            if (this.isPinching && pointerIds.length < 2) {
                this.isPinching = false;
                if (!this.videoArActive || !this.gyroActive) {
                    this.controls.enabled = true; // Rehabilitar cámara
                }
            }

            // Código de finalización de arrastre eliminado.

            // Si es un click rápido en el lienzo, no es arrastre ni doble toque
            if (clickDuration < 250 && !this.isDoubleTap) {
                // Ignorar clicks en el 30% inferior de la pantalla (zona del panel de control y botones)
                const screenHeight = window.innerHeight;
                const touchY = e.clientY;
                if (touchY > screenHeight - 260) {
                    return;
                }

                this.updateMouseCoords(e);

                let hitModel = false;
                if (this.placedModel) {
                    try {
                        const camera = this.xrSession ? this.renderer.xr.getCamera() : this.camera;
                        if (camera) {
                            this.raycaster.setFromCamera(this.mouse, camera);
                            const intersects = this.raycaster.intersectObject(this.placedModel, true);
                            if (intersects.length > 0) {
                                hitModel = true;
                            }
                        }
                    } catch (err) {
                        console.warn("Fallo en raycast, ignorando colisión:", err);
                    }
                }

                if (hitModel) {
                    // Si tocamos el modelo: relanzar físicas (rebote) pero NO abrir panel de control
                    this.triggerBounceDrop();
                } else {
                    // Si no tocamos el modelo, colocamos/reposicionamos el modelo en la última posición válida
                    if (this.lastValidReticlePosition) {
                        this.placeModel(this.lastValidReticlePosition);
                    }
                }
            }
        };

        dom.addEventListener('pointerup', onPointerUp);
        dom.addEventListener('pointercancel', onPointerUp);
    }

    /**
     * Mantiene actualizadas las coordenadas del ratón
     */
    updateMouseCoords(e) {
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    /**
     * Carga y actualiza la lista de modelos recientes desde IndexedDB
     */
    async loadRecentGallery() {
        const galleryContainer = document.getElementById('gallery-items');
        // Mantener presets (Cubo, Esfera, Toro) y remover los dinámicos anteriores
        const presetItems = galleryContainer.querySelectorAll('[data-preset]');
        galleryContainer.innerHTML = '';
        presetItems.forEach(item => galleryContainer.appendChild(item));

        try {
            const recentModels = await window.webarDB.getRecentModels();
            recentModels.forEach((model) => {
                const item = document.createElement('div');
                item.className = `gallery-item ${this.activeModelId === `db_${model.id}` ? 'active' : ''}`;
                item.setAttribute('data-db-id', model.id);
                item.innerHTML = `
                    <div class="gallery-icon">📦</div>
                    <div class="gallery-name" title="${model.name}">${model.name}</div>
                `;

                item.addEventListener('click', () => {
                    this.selectDBModel(model.id);
                    document.querySelectorAll('.gallery-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                });

                galleryContainer.appendChild(item);
            });
        } catch (error) {
            console.error('Error al poblar galería desde DB:', error);
        }
    }

    /**
     * Inicializa los objetos auxiliares en Three.js para visualizar los 12 principios
     */
    setupAnimationPrinciplesHelpers() {
        // 1. Luz de escenario (Staging - spotlight)
        this.stagingLight = new THREE.SpotLight(0x06b6d4, 0.0, 10, Math.PI / 5, 0.6, 1);
        this.stagingLight.castShadow = true;
        this.stagingLight.shadow.mapSize.width = 512;
        this.stagingLight.shadow.mapSize.height = 512;
        this.scene.add(this.stagingLight);
        this.scene.add(this.stagingLight.target);

        // 2. Anillo de onda de choque (Secondary Action - Grid ripple)
        const rippleGeo = new THREE.RingGeometry(0.01, 0.45, 32);
        rippleGeo.rotateX(-Math.PI / 2);
        const rippleMat = new THREE.MeshBasicMaterial({
            color: 0x06b6d4,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        this.rippleMesh = new THREE.Mesh(rippleGeo, rippleMat);
        this.rippleMesh.visible = false;
        this.scene.add(this.rippleMesh);

        // 3. Sistema de partículas por colisión (Secondary Action)
        const particleCount = 40;
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i*3] = 0;
            positions[i*3+1] = 0;
            positions[i*3+2] = 0;
            velocities.push(new THREE.Vector3());
        }

        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0x8b5cf6,
            size: 0.045,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.particleSystem = new THREE.Points(particleGeo, particleMat);
        this.particleSystem.userData = { velocities, activeLife: 0.0 };
        this.particleSystem.visible = false;
        this.scene.add(this.particleSystem);

        // 4. Elemento DOM para etiquetas de Dibujo Sólido (Solid Drawing)
        this.dimensionLabels = document.createElement('div');
        this.dimensionLabels.className = 'solid-dimension-label';
        this.dimensionLabels.style.opacity = '0';
        document.body.appendChild(this.dimensionLabels);
    }

    /**
     * Dispara los efectos visuales secundarios al colisionar con el suelo.
     */
    triggerSecondaryActionEffects(impactPos, velocity) {
        if (!this.rippleMesh || !this.particleSystem) return;

        const mult = this.physics.exaggeration;
        const strength = Math.min(1.0, velocity * 0.15);

        // 1. Posicionar y activar onda de choque (ripple)
        this.rippleMesh.position.copy(impactPos);
        this.rippleMesh.position.y += 0.005; // evitar z-fighting
        this.rippleMesh.scale.setScalar(0.01);
        this.rippleMesh.material.color.setHex(this.currentColor === '#06b6d4' ? 0x8b5cf6 : 0x06b6d4);
        this.rippleMesh.material.opacity = 0.85 * strength;
        this.rippleMesh.visible = true;

        // 2. Posicionar y activar partículas
        this.particleSystem.position.copy(impactPos);
        this.particleSystem.position.y += 0.01;
        this.particleSystem.material.color.set(this.currentColor);
        this.particleSystem.material.opacity = 1.0;
        this.particleSystem.visible = true;
        this.particleSystem.userData.activeLife = 1.0; // segundos de vida

        const posAttr = this.particleSystem.geometry.attributes.position;
        const count = posAttr.count;
        const vels = this.particleSystem.userData.velocities;

        for (let i = 0; i < count; i++) {
            // Empezar en el centro del impacto
            posAttr.setXYZ(i, 0, 0, 0);

            // Dirección radial 360 grados y hacia arriba
            const angle = Math.random() * Math.PI * 2;
            const hSpeed = (0.3 + Math.random() * 1.2) * strength * mult;
            const vSpeed = (0.5 + Math.random() * 2.2) * strength * mult;
            vels[i].set(
                Math.cos(angle) * hSpeed,
                vSpeed,
                Math.sin(angle) * hSpeed
            );
        }
        posAttr.needsUpdate = true;
        
        // 3. Efecto de Appeal (personalidad) en el impacto (pequeño giro o guiño de escala)
        if (this.physics.principles.appeal) {
            this.appealSpinTime = 0.25; // Pequeño shimmy
        }
    }

    /**
     * Genera las poses fantasma (Pose to Pose) a lo largo del arco proyectado.
     */
    spawnGhostMeshes() {
        this.clearGhostMeshes();
        if (!this.placedModel) return;

        const startX = this.placedModel.position.x;
        const startZ = this.placedModel.position.z;
        const floorY = this.physics.groundY;
        const velY = 6.0; // Velocidad Y de salto estándar
        const g = this.physics.gravity;

        // Tiempo total de vuelo hasta tocar el suelo: Y(t) = v0*t - 0.5*g*t^2 = 0 => t = 2 * v0 / g
        const flightTime = (2 * velY) / g;
        if (flightTime <= 0 || isNaN(flightTime)) return;

        // Crear 3 fantasmas a lo largo del trayecto: 25%, 50% (ápice), 75%
        const steps = [0.25, 0.5, 0.75];

        steps.forEach((ratio) => {
            const ghost = this.placedModel.clone();
            
            // Reemplazar material por una malla de alambre semitransparente
            ghost.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshBasicMaterial({
                        color: this.currentColor,
                        wireframe: true,
                        transparent: true,
                        opacity: 0.16 * this.physics.exaggeration
                    });
                }
            });

            // Calcular posición en el tiempo correspondiente
            const t = flightTime * ratio;
            const px = startX + this.physics.velocityX * t;
            const pz = startZ + this.physics.velocityZ * t;
            const py = floorY + (velY * t - 0.5 * g * t * t);

            ghost.position.set(px, py, pz);

            // Calcular deformación por estiramiento vertical en ese punto de la curva
            let scaleY = 1.0;
            if (this.physics.principles.squashStretch && ratio !== 0.5) {
                const instantVelY = velY - g * t;
                const velFactor = Math.min(0.22, Math.abs(instantVelY) * 0.015) * this.physics.exaggeration;
                scaleY += velFactor;
            }
            const scaleXZ = 1.0 / Math.sqrt(scaleY);
            ghost.scale.set(scaleXZ, scaleY, scaleXZ);

            this.scene.add(ghost);
            this.ghostMeshes.push(ghost);
        });
    }

    /**
     * Limpia todas las poses fantasma del escenario.
     */
    clearGhostMeshes() {
        this.ghostMeshes.forEach((ghost) => {
            this.scene.remove(ghost);
        });
        this.ghostMeshes = [];
    }

    /**
     * Lanza un salto dinámico aplicando arcos, anticipación y ritmo.
     */
    triggerAnimatedJump() {
        if (!this.placedModel) {
            this.showToast('Apunta y coloca el modelo en la superficie antes de animar.', 'warning');
            return;
        }

        if (this.physics.isSimulating || this.physics.isAnticipating) {
            return; // Ya está animándose
        }

        const startX = this.placedModel.position.x;
        const startZ = this.placedModel.position.z;
        const floorY = this.physics.groundY;

        let velX = 0;
        let velZ = 0;
        const jumpVelY = 6.0;

        // Principio: Arcos (Salto parabólico tridimensional)
        if (this.physics.principles.arcs) {
            // Ángulo aleatorio y distancia horizontal
            const angle = Math.random() * Math.PI * 2;
            const distance = (0.7 + Math.random() * 0.8); // 0.7 a 1.5 metros
            
            // Vuelo aproximado: t = 2 * v0y / g
            const flightTime = (2 * jumpVelY) / this.physics.gravity;
            const speed = distance / flightTime;
            
            velX = Math.cos(angle) * speed;
            velZ = Math.sin(angle) * speed;
            
            this.showToast('¡Despegando salto en arco (parábola)!');
        } else {
            this.showToast('¡Lanzando salto vertical!');
        }

        // Ejecutar impulso en Y
        this.physics.applyImpulse(jumpVelY, velX, velZ);
    }

    /**
     * Selecciona un modelo predefinido (Preset)
     */
    selectPreset(name) {
        this.activeModelId = `preset_${name}`;
        
        let geometry;
        if (name === 'cube') {
            geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        } else if (name === 'sphere') {
            geometry = new THREE.SphereGeometry(0.18, 32, 32);
        } else if (name === 'torus') {
            geometry = new THREE.TorusKnotGeometry(0.12, 0.04, 64, 8);
        }

        // Mover el origen de la geometría a su base (para que al deformar o rebotar sobre Y=0 quede exacto)
        geometry.computeBoundingBox();
        const yOffset = -geometry.boundingBox.min.y;
        geometry.translate(0, yOffset, 0);

        const material = new THREE.MeshStandardMaterial({
            color: this.currentColor,
            roughness: this.roughness,
            metalness: this.metalness,
            shadowSide: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        this.setActiveModel(mesh);
        this.showToast(`Modelo predefinido '${name}' seleccionado.`);
    }

    /**
     * Selecciona y carga un modelo guardado en IndexedDB
     */
    async selectDBModel(id) {
        this.activeModelId = `db_${id}`;
        this.showToast('Cargando modelo desde persistencia local...', 'info');

        try {
            const models = await window.webarDB.getRecentModels();
            const modelData = models.find(m => m.id === id);

            if (!modelData) throw new Error('Modelo no encontrado en la base de datos.');

            const blobUrl = URL.createObjectURL(modelData.data);
            const extension = modelData.name.split('.').pop().toLowerCase();

            this.load3DFile(blobUrl, extension, modelData.name, () => {
                URL.revokeObjectURL(blobUrl);
            });
        } catch (error) {
            console.error(error);
            this.showToast(`Error al cargar modelo persistido: ${error.message}`);
        }
    }

    /**
     * Procesa la subida de un nuevo archivo, lo persiste en DB y lo selecciona
     */
    async handleFileUpload(file) {
        const validExtensions = ['obj', 'stl', 'glb', 'gltf'];
        const extension = file.name.split('.').pop().toLowerCase();

        if (!validExtensions.includes(extension)) {
            this.showToast('Formato no soportado. Utiliza .obj, .stl, .glb o .gltf.', 'error');
            return;
        }

        this.showToast('Cargando archivo 3D...', 'info');

        // Generar URL temporal para cargarlo inmediatamente
        const fileUrl = URL.createObjectURL(file);
        
        this.load3DFile(fileUrl, extension, file.name, async () => {
            // Callback al cargar exitosamente: Guardar en base de datos local
            try {
                const dbId = await window.webarDB.saveModel(file, file.name);
                this.activeModelId = `db_${dbId}`;
                await this.loadRecentGallery();
                this.showToast(`'${file.name}' cargado e indexado correctamente.`);
            } catch (err) {
                console.error('Error al guardar modelo en la persistencia:', err);
                this.showToast('Modelo cargado pero no pudo persistirse.');
            } finally {
                URL.revokeObjectURL(fileUrl);
            }
        }, () => {
            // Callback de error
            URL.revokeObjectURL(fileUrl);
        });
    }

    /**
     * Carga física de un archivo URL con el cargador correspondiente
     */
    load3DFile(url, extension, name, onSuccess, onError) {
        const onModelLoaded = (object3d) => {
            // Asegurar que el objeto proyecta sombras
            object3d.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // Asegurar material estándar
                    if (child.material) {
                        const origMat = child.material;
                        child.material = new THREE.MeshStandardMaterial({
                            color: this.currentColor,
                            roughness: this.roughness,
                            metalness: this.metalness,
                            shadowSide: THREE.DoubleSide
                        });
                        // Copiar mapa de textura original si existe
                        if (origMat.map) child.material.map = origMat.map;
                    }
                }
            });

            // Medir tamaño del modelo para escalarlo automáticamente a proporciones AR humanas (aprox. 0.4 metros)
            const box = new THREE.Box3().setFromObject(object3d);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scaleFactor = (maxDim > 0 && !isNaN(maxDim) && isFinite(maxDim)) ? (0.4 / maxDim) : 1.0;
            
            object3d.scale.setScalar(scaleFactor);

            // Ajustar posición del punto pivote vertical a la base del bounding box
            const updatedBox = new THREE.Box3().setFromObject(object3d);
            const lowestY = updatedBox.min.y;
            
            // Creamos un contenedor raíz para ajustar el pivote Y a 0
            const containerGroup = new THREE.Group();
            object3d.position.y = (isNaN(lowestY) || !isFinite(lowestY)) ? 0.0 : -lowestY;
            containerGroup.add(object3d);

            this.setActiveModel(containerGroup);
            if (onSuccess) onSuccess();
        };

        const onLoadError = (err) => {
            console.error(`Error de carga para formato .${extension}:`, err);
            this.showToast(`Error al parsear el archivo .${extension}.`, 'error');
            if (onError) onError();
        };

        if (extension === 'glb' || extension === 'gltf') {
            this.gltfLoader.load(url, (gltf) => {
                onModelLoaded(gltf.scene);
            }, undefined, onLoadError);
        } else if (extension === 'obj') {
            this.objLoader.load(url, (obj) => {
                onModelLoaded(obj);
            }, undefined, onLoadError);
        } else if (extension === 'stl') {
            this.stlLoader.load(url, (geometry) => {
                // STL cargador devuelve solo la geometría, creamos una malla
                const material = new THREE.MeshStandardMaterial({
                    color: this.currentColor,
                    roughness: this.roughness,
                    metalness: this.metalness
                });
                const mesh = new THREE.Mesh(geometry, material);
                onModelLoaded(mesh);
            }, undefined, onLoadError);
        }
    }

    /**
     * Establece el modelo activo que se colocará en la escena
     */
    setActiveModel(model) {
        this.activeModel = model;

        // Si ya hay un modelo colocado, lo actualizamos inmediatamente con el nuevo diseño
        if (this.placedModel) {
            const lastPosition = this.placedModel.position.clone();
            const lastRotation = this.placedModel.rotation.clone();
            this.scene.remove(this.placedModel);
            
            this.placedModel = this.activeModel.clone();
            this.placedModel.position.copy(lastPosition);
            this.placedModel.rotation.copy(lastRotation);
            this.scene.add(this.placedModel);

            // Aplicar deformación y estilo activo
            this.updateDeformation();
            this.updateColor();
            this.updateMaterialProperties();
            this.updateMaterialType();

            // Re-ejecutar física si estaba corriendo
            if (this.physics.isSimulating) {
                this.physics.startDrop(this.physics.groundY);
            }
        }
    }

    /**
     * Coloca el modelo seleccionado en la escena (Modo AR o Simulador)
     */
    placeModel(position, rotation = null) {
        if (!this.activeModel) return;

        // Eliminar modelo colocado anteriormente si existe
        if (this.placedModel) {
            this.scene.remove(this.placedModel);
        }

        // Clonar el modelo activo para posicionarlo
        this.placedModel = this.activeModel.clone();
        this.placedModel.position.copy(position);
        
        if (rotation) {
            this.placedModel.quaternion.copy(rotation);
        }

        this.scene.add(this.placedModel);

        // Aplicar estado actual de deformación y color
        this.updateDeformation();
        this.updateColor();
        this.updateMaterialProperties();
        this.updateMaterialType();

        // Iniciar rebote físico dinámico desde la altura de caída configurada
        this.physics.startDrop(position.y);

        this.showToast('Modelo colocado en la superficie.');

        // Ocultar letrero de instrucciones de forma inmediata
        const instr = document.getElementById('instructions-overlay');
        if (instr) {
            instr.style.opacity = '0';
        }
    }


    /**
     * Dispara de nuevo el lanzamiento/caída física
     */
    triggerBounceDrop() {
        // Si no está colocado el modelo, pero hay una retícula válida, lo colocamos ahí primero
        if (!this.placedModel) {
            if (this.lastValidReticlePosition) {
                this.placeModel(this.lastValidReticlePosition);
                this.showToast('Objeto colocado y físicas ejecutadas.');
                return;
            } else {
                this.showToast('Apunta a una superficie para detectar el suelo antes de ejecutar físicas.', 'warning');
                return;
            }
        }

        // Usar la Y del suelo donde está colocado el modelo, sin moverlo de posición
        const floorY = this.placedModel.position.y;

        this.physics.startDrop(floorY);
        this.showToast('Físicas ejecutadas.');
    }

    /**
     * Aplica la escala/deformación actual
     */
    updateDeformation() {
        // La deformación de volumen conservado ahora se calcula en la GPU de manera fluida (render loop)
    }

    /**
     * Actualiza color de material
     */
    updateColor() {
        if (this.currentMaterialType === 'solid') {
            if (this.placedModel) {
                this.deformer.changeColor(this.placedModel, this.currentColor);
            }
            // También actualizar el color en la plantilla activa para futuras colocaciones
            if (this.activeModel) {
                this.deformer.changeColor(this.activeModel, this.currentColor);
            }
        }
    }

    /**
     * Actualiza propiedades físicas del material
     */
    updateMaterialProperties() {
        if (this.placedModel) {
            this.deformer.changeMaterialProperties(this.placedModel, this.roughness, this.metalness);
        }
        if (this.activeModel) {
            this.deformer.changeMaterialProperties(this.activeModel, this.roughness, this.metalness);
        }
    }

    updateMaterialType() {
        if (this.placedModel) {
            this.deformer.changeMaterialType(this.placedModel, this.currentMaterialType, this.currentColor);
        }
        if (this.activeModel) {
            this.deformer.changeMaterialType(this.activeModel, this.currentMaterialType, this.currentColor);
        }
    }

    /**
     * Gestiona el encendido/apagado de la sesión WebXR
     */
    async toggleXRSession() {
        if (!this.xrSession) {
            // Solicitar sesión AR
            const sessionInit = {
                requiredFeatures: ['local', 'hit-test'],
                optionalFeatures: ['dom-overlay'],
                domOverlay: { root: document.body }
            };

            try {
                const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
                this.onXRSessionStarted(session);
            } catch (err) {
                console.error('Error al iniciar sesión WebXR:', err);
                this.showToast('No se pudo iniciar sesión AR.', 'error');
            }
        } else {
            this.xrSession.end();
        }
    }

    /**
     * Lanza AR Quick Look nativo en iOS Safari/Chrome.
     * Exporta el modelo actual (con su color, material y deformación horneados) a USDZ
     * en el propio navegador usando USDZExporter, y abre el visor AR nativo de Apple.
     * Nota: Quick Look muestra el modelo estático; el motor de físicas/deformación en vivo
     * es código Three.js que el visor nativo no ejecuta.
     */
    async launchQuickLook() {
        const source = this.placedModel || this.activeModel;
        if (!source) {
            this.showToast('Selecciona o coloca un modelo primero.', 'warning');
            return;
        }

        this.showToast('Generando vista AR para iOS...', 'info');

        try {
            // Clonar el modelo para no alterar la escena en vivo
            const exportRoot = source.clone(true);

            // Hornear la deformación/escala actual si proviene del modelo colocado
            if (this.placedModel) {
                exportRoot.scale.copy(this.placedModel.scale);
            }
            exportRoot.updateMatrixWorld(true);

            const exporter = new USDZExporter();
            const usdzData = await exporter.parse(exportRoot);
            const blob = new Blob([usdzData], { type: 'model/vnd.usdz+zip' });
            const url = URL.createObjectURL(blob);

            // AR Quick Look se dispara con un <a rel="ar"> que contiene un <img>
            const anchor = document.createElement('a');
            anchor.setAttribute('rel', 'ar');
            anchor.appendChild(document.createElement('img'));
            anchor.href = url;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);

            // Liberar memoria tras dar tiempo a que iOS cargue el archivo
            setTimeout(() => URL.revokeObjectURL(url), 15000);
        } catch (err) {
            console.error('Error al generar USDZ para Quick Look:', err);
            this.showToast('No se pudo generar la vista AR de iOS.', 'error');
        }
    }

    onXRSessionStarted(session) {
        this.xrSession = session;
        document.body.classList.add('ar-active');
        
        session.addEventListener('end', () => this.onXRSessionEnded());

        // Desactivar niebla y sombras en AR para rendimiento y compatibilidad en iOS (WebXR Viewer)
        this.previousFog = this.scene.fog;
        this.scene.fog = null;
        this.previousShadowMapEnabled = this.renderer.shadowMap.enabled;
        this.renderer.shadowMap.enabled = false;

        // Configurar letrero de instrucciones inicial en AR
        const instr = document.getElementById('instructions-overlay');
        if (instr) {
            if (this.placedModel) {
                instr.style.opacity = '0';
            } else {
                instr.style.opacity = '1';
                instr.textContent = 'Mueve tu dispositivo para escanear superficies...';
            }
        }

        // Resetear bandera de colocación en AR y posiciones de retícula
        this.arModelPlaced = false;
        this.lastValidReticlePosition = null;
        this.lastValidReticleRotation = null;
        this.noHitFrames = 0;

        // Obtener espacio de referencia
        this.renderer.xr.setReferenceSpaceType('local');
        
        session.requestReferenceSpace('viewer').then((refSpace) => {
            session.requestHitTestSource({ space: refSpace }).then((source) => {
                this.hitTestSource = source;
            });
        });

        this.renderer.xr.setSession(session);

        // Controladores táctiles AR (WebXR Controller Fallback para WebXR Viewer)
        const controller = this.renderer.xr.getController(0);
        controller.addEventListener('select', () => {
            // Ignorar toques en el 30% inferior de la pantalla (zona del panel de control y botones)
            const screenHeight = window.innerHeight;
            const touchY = this.lastTouchY || 0;
            if (touchY > screenHeight - 260) {
                return;
            }

            // 1. Raycast desde la cámara activa de WebXR para ver si toca el modelo colocado
            let hitModel = false;
            if (this.placedModel) {
                try {
                    const camera = this.renderer.xr.getCamera();
                    if (camera) {
                        const mouseX = ((this.lastTouchX || 0) / window.innerWidth) * 2 - 1;
                        const mouseY = -((this.lastTouchY || 0) / window.innerHeight) * 2 + 1;
                        const touchCoords = new THREE.Vector2(mouseX, mouseY);
                        this.raycaster.setFromCamera(touchCoords, camera);

                        const intersects = this.raycaster.intersectObject(this.placedModel, true);
                        if (intersects.length > 0) {
                            hitModel = true;
                        }
                    }
                } catch (err) {
                    console.warn("Fallo en raycast en AR, ignorando colisión:", err);
                }
            }

            if (hitModel) {
                this.triggerBounceDrop();
                return;
            }

            // 2. Si no toca el modelo, colocar/reposicionar en la última posición válida de la retícula
            if (this.lastValidReticlePosition) {
                this.placeModel(this.lastValidReticlePosition);
            }
        });
        this.scene.add(controller);

        // Ocultar rejilla física de escritorio
        this.gridHelper.visible = false;
        this.shadowPlane.visible = false;

        this.showToast('Sesión AR iniciada. Mueve tu dispositivo para escanear superficies.', 'info');
    }

    onXRSessionEnded() {
        this.xrSession = null;
        this.hitTestSource = null;
        document.body.classList.remove('ar-active');

        // Restaurar niebla y sombras para el simulador de escritorio
        if (this.previousFog) {
            this.scene.fog = this.previousFog;
        }
        if (this.previousShadowMapEnabled !== undefined) {
            this.renderer.shadowMap.enabled = this.previousShadowMapEnabled;
        }

        // Restaurar estado de visibilidad del panel de control
        const drawer = document.getElementById('control-drawer');
        if (drawer) {
            drawer.classList.remove('ar-visible');
        }

        // Restaurar rejilla del simulador
        this.gridHelper.visible = true;
        this.shadowPlane.visible = true;
        
        // Restaurar letrero de instrucciones
        const instr = document.getElementById('instructions-overlay');
        if (instr) {
            if (this.placedModel) {
                instr.style.opacity = '0';
            } else {
                instr.style.opacity = '1';
                instr.textContent = 'Haz clic en la cuadrícula para colocar el objeto seleccionado';
            }
        }

        this.showToast('Sesión AR terminada.');
    }

    /**
     * Calcula una posición de colocación ~1 m frente a la cámara WebXR, a una altura
     * estimada de suelo. Se usa como fallback cuando el hit-test no devuelve superficies
     * (caso típico de WebXR Viewer en iOS), para que el modelo siempre pueda colocarse.
     * @returns {THREE.Vector3|null}
     */
    getFallbackPlacementPosition() {
        const xrCamera = this.renderer.xr.getCamera();
        if (!xrCamera) return null;

        const camPos = new THREE.Vector3();
        xrCamera.getWorldPosition(camPos);

        const camDir = new THREE.Vector3();
        xrCamera.getWorldDirection(camDir);

        // Aplanar la dirección al plano horizontal para colocar sobre un "suelo" frente al usuario
        camDir.y = 0;
        if (camDir.lengthSq() < 1e-6) {
            camDir.set(0, 0, -1);
        }
        camDir.normalize();

        const point = camPos.clone().add(camDir.multiplyScalar(1.0));
        // Estimar el suelo ~1.3 m por debajo de la altura de los ojos
        point.y = camPos.y - 1.3;

        if (isNaN(point.x) || isNaN(point.y) || isNaN(point.z)) return null;
        return point;
    }

    /**
     * Bucle de actualización y dibujo
     */
    render(time, frame) {
        let dt = this.clock.getDelta();
        if (isNaN(dt) || dt < 0 || dt > 0.1) {
            dt = 0.016; // Fallback estable a ~60fps si hay saltos de frames en el renderizado
        }

        // 1. Actualizar controles de cámara orbital o giroscopio (según el modo)
        if (!this.xrSession) {
            if (this.videoArActive) {
                // Modo Video AR (iOS Safari fallback): Proyectar retícula en el centro, sobre un suelo virtual a 1.2m bajo la cámara
                const camPos = new THREE.Vector3();
                this.camera.getWorldPosition(camPos);
                
                const camDir = new THREE.Vector3();
                this.camera.getWorldDirection(camDir);
                
                // Aplanar la dirección horizontalmente
                camDir.y = 0;
                if (camDir.lengthSq() < 1e-6) {
                    camDir.set(0, 0, -1);
                }
                camDir.normalize();
                
                // Colocar la retícula a 1.5 metros delante, y 1.2 metros abajo de la cámara
                const point = camPos.clone().add(camDir.multiplyScalar(1.5));
                point.y = camPos.y - 1.2;
                
                this.reticle.visible = true;
                const matrix = new THREE.Matrix4().makeTranslation(point.x, point.y, point.z);
                this.reticle.matrix.copy(matrix);
                
                if (!this.lastValidReticlePosition) {
                    this.lastValidReticlePosition = new THREE.Vector3();
                }
                this.lastValidReticlePosition.copy(point);
            } else {
                // Modo Simulador de escritorio estándar
                this.controls.update();
                
                // Raycasting de la retícula en modo simulador (siguiendo al cursor del ratón sobre la rejilla)
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.shadowPlane);

                if (intersects.length > 0) {
                    const point = intersects[0].point;
                    this.reticle.visible = true;
                    
                    // Actualizar matriz de la retícula
                    const matrix = new THREE.Matrix4().makeTranslation(point.x, point.y, point.z);
                    this.reticle.matrix.copy(matrix);

                    // Guardar la última posición válida en simulador
                    if (!this.lastValidReticlePosition) {
                        this.lastValidReticlePosition = new THREE.Vector3();
                    }
                    this.lastValidReticlePosition.copy(point);
                } else {
                    this.reticle.visible = false;
                }
            }
        } else {
            // Modo WebXR AR Activo: Ejecutar Hit Test
            if (frame && this.hitTestSource) {
                const referenceSpace = this.renderer.xr.getReferenceSpace();
                const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                if (hitTestResults.length > 0) {
                    // El hit-test funciona: reiniciar el contador de fallback
                    this.noHitFrames = 0;

                    const hit = hitTestResults[0];
                    const pose = hit.getPose(referenceSpace);

                    if (pose && pose.transform && pose.transform.matrix) {
                        const matrix = pose.transform.matrix;
                        let hasNaN = false;
                        for (let i = 0; i < matrix.length; i++) {
                            if (isNaN(matrix[i])) {
                                hasNaN = true;
                                break;
                            }
                        }

                        if (!hasNaN) {
                            this.reticle.visible = true;
                            this.reticle.matrix.fromArray(matrix);
                            
                            // Guardar la última posición y rotación válidas de la retícula en AR
                            if (!this.lastValidReticlePosition) {
                                this.lastValidReticlePosition = new THREE.Vector3();
                            }
                            this.lastValidReticlePosition.setFromMatrixPosition(this.reticle.matrix);
                            
                            // Mostrar o esconder recordatorio según si hay modelo colocado
                            const instr = document.getElementById('instructions-overlay');
                            if (instr) {
                                if (!this.placedModel) {
                                    instr.style.opacity = '1';
                                    instr.textContent = '¡Superficie detectada! Toca la pantalla para colocar el modelo.';
                                } else {
                                    instr.style.opacity = '0';
                                }
                            }
                        } else {
                            this.reticle.visible = false;
                        }
                    } else {
                        this.reticle.visible = false;
                    }
                } else {
                    // Sin superficies detectadas: tras ~1.5s usar fallback frente a la cámara.
                    // Necesario en WebXR Viewer (iOS), cuyo hit-test suele no devolver resultados.
                    this.noHitFrames++;

                    if (this.noHitFrames > 90) {
                        const fallbackPos = this.getFallbackPlacementPosition();
                        if (fallbackPos) {
                            this.reticle.visible = true;
                            this.reticle.matrix.makeTranslation(fallbackPos.x, fallbackPos.y, fallbackPos.z);

                            if (!this.lastValidReticlePosition) {
                                this.lastValidReticlePosition = new THREE.Vector3();
                            }
                            this.lastValidReticlePosition.copy(fallbackPos);

                            const instr = document.getElementById('instructions-overlay');
                            if (instr && !this.placedModel) {
                                instr.style.opacity = '1';
                                instr.textContent = 'No se detectan superficies. Toca la pantalla para colocar el modelo frente a ti.';
                            }
                        } else {
                            this.reticle.visible = false;
                        }
                    } else {
                        this.reticle.visible = false;
                    }
                }
            }
        }

        // La altura del suelo (groundY) se establece al colocar/arrastrar el modelo, y se mantiene fija
        // para evitar que el modelo flote o se hunda cuando la cámara apunta hacia otras superficies en AR.

        // 2. Actualizar simulación de físicas e inercia tridimensional
        if ((this.physics.isSimulating || this.physics.isAnticipating) && this.placedModel) {
            this.physics.update(dt, 
                (newY, newX, newZ) => {
                    this.placedModel.position.set(newX, newY, newZ);
                },
                () => {
                    this.showToast('Objeto en reposo.');
                    this.clearGhostMeshes();
                }
            );
        }

        // 3. Puesta en Escena (Staging): Luz de realce que sigue al modelo
        if (this.placedModel && this.physics.principles.staging && this.stagingLight) {
            this.stagingLight.position.set(this.placedModel.position.x, this.placedModel.position.y + 2.5, this.placedModel.position.z);
            this.stagingLight.target.position.copy(this.placedModel.position);
            
            if (this.physics.isSimulating || this.physics.isAnticipating) {
                this.stagingLight.intensity = THREE.MathUtils.lerp(this.stagingLight.intensity, 6.0, 0.1);
            } else {
                this.stagingLight.intensity = THREE.MathUtils.lerp(this.stagingLight.intensity, 0.0, 0.1);
            }
        } else if (this.stagingLight) {
            this.stagingLight.intensity = 0.0;
        }

        // 4. Acción Secundaria (Secondary Action): Ondas expansivas y partículas en colisión
        if (this.rippleMesh && this.rippleMesh.visible) {
            this.rippleMesh.scale.addScalar(dt * 3.2 * this.physics.exaggeration);
            this.rippleMesh.material.opacity -= dt * 2.2;
            if (this.rippleMesh.material.opacity <= 0) {
                this.rippleMesh.visible = false;
            }
        }

        if (this.particleSystem && this.particleSystem.visible) {
            this.particleSystem.userData.activeLife -= dt * 1.6;
            if (this.particleSystem.userData.activeLife <= 0) {
                this.particleSystem.visible = false;
            } else {
                this.particleSystem.material.opacity = this.particleSystem.userData.activeLife;
                const posAttr = this.particleSystem.geometry.attributes.position;
                const count = posAttr.count;
                const vels = this.particleSystem.userData.velocities;
                
                for (let i = 0; i < count; i++) {
                    const px = posAttr.getX(i) + vels[i].x * dt;
                    const py = posAttr.getY(i) + vels[i].y * dt;
                    const pz = posAttr.getZ(i) + vels[i].z * dt;
                    posAttr.setXYZ(i, px, py, pz);
                    
                    // Aplicar gravedad en partículas
                    vels[i].y -= 9.8 * dt;
                }
                posAttr.needsUpdate = true;
            }
        }

        // 5. Dibujo Sólido (Solid Drawing): Límites de caja, vectores y etiquetas DOM flotantes
        if (this.placedModel && this.physics.principles.solidDrawing) {
            // A. Jaula de alambre
            if (!this.boxHelper) {
                this.boxHelper = new THREE.BoxHelper(this.placedModel, 0x06b6d4);
                this.scene.add(this.boxHelper);
            }
            this.boxHelper.setFromObject(this.placedModel);
            this.boxHelper.visible = true;

            // B. Vector de gravedad / balance
            if (!this.vectorArrow) {
                const dir = new THREE.Vector3(0, -1, 0);
                const origin = new THREE.Vector3(0, 0, 0);
                this.vectorArrow = new THREE.ArrowHelper(dir, origin, 0.5, 0xef4444, 0.1, 0.05);
                this.scene.add(this.vectorArrow);
            }
            const box = new THREE.Box3().setFromObject(this.placedModel);
            const center = new THREE.Vector3();
            box.getCenter(center);
            this.vectorArrow.position.copy(center);
            
            const arrowLength = (this.physics.gravity * this.physics.mass) * 0.03 * this.physics.exaggeration;
            this.vectorArrow.setLength(Math.max(0.1, arrowLength), 0.08, 0.04);
            this.vectorArrow.visible = true;

            // C. Cartel informativo flotante en coordenadas de pantalla 2D
            if (this.dimensionLabels) {
                const topCenter = new THREE.Vector3((box.min.x + box.max.x)/2, box.max.y + 0.12, (box.min.z + box.max.z)/2);
                topCenter.project(this.camera);
                
                const labelX = (topCenter.x * 0.5 + 0.5) * window.innerWidth;
                const labelY = (-(topCenter.y * 0.5) + 0.5) * window.innerHeight;
                
                this.dimensionLabels.style.left = `${labelX}px`;
                this.dimensionLabels.style.top = `${labelY}px`;
                this.dimensionLabels.style.opacity = '1';
                
                const w = (box.max.x - box.min.x).toFixed(2);
                const h = (box.max.y - box.min.y).toFixed(2);
                const volDiff = ((this.placedModel.scale.y * this.placedModel.scale.x * this.placedModel.scale.z - 1.0) * 100).toFixed(0);
                
                this.dimensionLabels.innerHTML = `
                    Alto: ${h}m | Ancho: ${w}m<br>
                    Volumen: ${volDiff >= 0 ? '+' : ''}${volDiff}%
                `;
            }
        } else {
            if (this.boxHelper) this.boxHelper.visible = false;
            if (this.vectorArrow) this.vectorArrow.visible = false;
            if (this.dimensionLabels) this.dimensionLabels.style.opacity = '0';
        }

        // 6. Atractivo y Personalidad (Appeal / Idle Breathing)
        let appealScaleY = 1.0;
        let appealScaleXZ = 1.0;

        if (this.placedModel) {
            // Giro animado tipo saludo/giro al saltar o interactuar
            if (this.appealSpinTime > 0) {
                this.appealSpinTime -= dt;
                this.placedModel.rotation.y += dt * 12 * this.physics.exaggeration;
            }
            
            // Respiración ociosa (idle breathing)
            if (this.physics.principles.appeal && !this.physics.isSimulating && !this.physics.isAnticipating && !this.isDragging) {
                const breatheTime = time * 2.5;
                appealScaleY = 1.0 + 0.025 * Math.sin(breatheTime) * this.physics.exaggeration;
                appealScaleXZ = 1.0 / Math.sqrt(appealScaleY);
            }
        }

        // 7. Aplicar Squash & Stretch visual (Animación física elástica) y Deformación
        if (this.placedModel) {
            let scaleY = 1.0;
            let scaleXZ = 1.0;

            if (!this.isDragging) {
                if (this.physics.principles.squashStretch) {
                    // Si está en anticipación, usar squash de compresión previa
                    if (this.physics.isAnticipating) {
                        scaleY = this.physics.anticipationSquash;
                        scaleXZ = 1.0 / Math.sqrt(scaleY);
                    } else if (this.physics.isSimulating && Math.abs(this.physics.velocityY) > 0.1) {
                        // Estiramiento vertical en caída libre por velocidad
                        const velFactor = Math.min(0.25, Math.abs(this.physics.velocityY) * 0.015) * this.physics.exaggeration;
                        scaleY += velFactor;
                        scaleXZ -= velFactor * 0.5;
                    }

                    // Aplastamiento elástico al colisionar con el suelo (efecto gelatina)
                    if (this.squashAmount > 0.0) {
                        this.squashTimer += dt;
                        const decay = Math.exp(-8 * this.squashTimer); // Amortiguación
                        const osc = Math.cos(22 * this.squashTimer);   // Frecuencia
                        const currentSquash = this.squashAmount * decay * osc;

                        scaleY -= currentSquash;
                        scaleXZ += currentSquash * 0.5;

                        // Detener oscilación si el efecto es insignificante
                        if (decay < 0.01) {
                            this.squashAmount = 0.0;
                        }
                    }
                }
            }

            // Físicas: Inflado elástico (deformación de volumen expansiva por doble toque)
            let inflateScaleY = 1.0;
            let inflateScaleXZ = 1.0;

            if (this.inflateAmount > 0.0) {
                this.inflateTimer += dt;
                const decay = Math.exp(-4 * this.inflateTimer); // Decaimiento suave
                const osc = Math.sin(15 * this.inflateTimer);   // Oscilación senoidal
                const currentInflate = this.inflateAmount * decay * (1.0 + osc * 0.4);

                inflateScaleY += currentInflate;
                inflateScaleXZ += currentInflate;

                if (decay < 0.01) {
                    this.inflateAmount = 0.0;
                }
            }

            // Combinar con la deformación de volumen conservado del slider/pellizco, respiración e inflado
            const finalScaleY = this.currentDeformation * scaleY * inflateScaleY * appealScaleY;
            const finalScaleXZ = (1.0 / Math.sqrt(this.currentDeformation)) * scaleXZ * inflateScaleXZ * appealScaleXZ;

            // 8. Acción Continuada (Follow Through): Deformación por corte (shearing)
            let shearX = 0;
            let shearZ = 0;

            if (this.physics.principles.followThrough && !this.isDragging) {
                const currentPos = this.placedModel.position.clone();
                const deltaX = currentPos.x - this.lastPosition.x;
                const deltaZ = currentPos.z - this.lastPosition.z;
                this.lastPosition.copy(currentPos);

                const speedLimit = 6.0;
                const vx = Math.max(-speedLimit, Math.min(speedLimit, deltaX / Math.max(0.001, dt)));
                const vz = Math.max(-speedLimit, Math.min(speedLimit, deltaZ / Math.max(0.001, dt)));

                // Filtro paso bajo para suavizar movimientos rápidos
                this.horizontalVelocity.x = THREE.MathUtils.lerp(this.horizontalVelocity.x, vx, 0.15);
                this.horizontalVelocity.z = THREE.MathUtils.lerp(this.horizontalVelocity.z, vz, 0.15);

                // Corte opuesto a la velocidad horizontal
                shearX = -this.horizontalVelocity.x * 0.065 * this.physics.exaggeration;
                shearZ = -this.horizontalVelocity.z * 0.065 * this.physics.exaggeration;
            } else {
                this.lastPosition.copy(this.placedModel.position);
            }

            // Aplicar matriz local manual para deformaciones complejas (corte lateral) en GPU
            this.placedModel.matrixAutoUpdate = false;
            this.placedModel.scale.set(finalScaleXZ, finalScaleY, finalScaleXZ);
            this.placedModel.updateMatrix();

            // Modificar elementos de matriz para simular flexión (Shearing)
            if (this.physics.principles.followThrough) {
                this.placedModel.matrix.elements[4] = shearX; // Shear X por Y
                this.placedModel.matrix.elements[6] = shearZ; // Shear Z por Y
            }
        }

        // 9. Sacudida de Cámara (Staging - Impact Camera Shake)
        if (this.cameraShakeTime > 0) {
            this.cameraShakeTime -= dt;
            const shake = this.cameraShakeIntensity * (this.cameraShakeTime / 0.22);
            this.camera.position.x += (Math.random() - 0.5) * shake;
            this.camera.position.y += (Math.random() - 0.5) * shake;
            this.camera.position.z += (Math.random() - 0.5) * shake;
        }

        // 3. Renderizar la escena
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Muestra una notificación visual tipo toast
     */
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;

        toast.className = `show ${type}`;
        toast.textContent = message;

        // Limpiar temporizador anterior si existe
        if (this.toastTimeout) clearTimeout(this.toastTimeout);

        this.toastTimeout = setTimeout(() => {
            toast.className = '';
        }, 3000);
    }

    /**
     * Inicia la experiencia AR interactiva con video en iOS Safari
     */
    async startVideoAR() {
        this.videoArActive = true;
        this.gyroActive = false;
        this.initialOrientation = null;

        // 1. Solicitar acceso a la cámara trasera
        const video = document.getElementById('ar-video-background');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
            this.videoStream = stream;
            if (video) {
                video.srcObject = stream;
                video.style.display = 'block';
                video.setAttribute('autoplay', '');
                video.setAttribute('playsinline', '');
                video.play().catch(err => console.error("Error al reproducir video:", err));
            }
        } catch (err) {
            console.error("Error de acceso a la cámara:", err);
            this.showToast("No se pudo acceder a la cámara. Iniciando sin video de fondo.", "error");
        }

        // 2. Modificar clases de interfaz
        document.body.classList.add('ar-active');
        const exitContainer = document.getElementById('exit-ar-container');
        if (exitContainer) {
            exitContainer.style.display = 'block';
        }

        // Mostrar botón de ajustes en AR
        const settingsBtn = document.getElementById('settings-button-container');
        if (settingsBtn) {
            settingsBtn.style.display = 'block';
        }

        // 3. Modificar escena 3D
        this.gridHelper.visible = false;
        this.previousFog = this.scene.fog;
        this.scene.fog = null;
        this.previousShadowMapEnabled = this.renderer.shadowMap.enabled;
        this.renderer.shadowMap.enabled = true; // Habilitar sombras en la mesa virtual

        // 4. Solicitar permiso de giroscopio y configurar DeviceOrientation
        this.handleDeviceOrientationBound = this.handleDeviceOrientation.bind(this);
        
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', this.handleDeviceOrientationBound);
                    this.gyroActive = true;
                    this.controls.enabled = false; // Desactivar OrbitControls si el giroscopio está activo
                    this.showToast("Giroscopio activado para seguimiento AR.");
                } else {
                    this.showToast("Giroscopio denegado. Usando arrastre para rotar la cámara.", "info");
                }
            } catch (err) {
                console.warn("Giroscopio no permitido o fallido:", err);
                this.showToast("Usa arrastre táctil para rotar la vista.", "info");
            }
        } else {
            // Android u otros navegadores
            window.addEventListener('deviceorientation', this.handleDeviceOrientationBound);
            this.gyroActive = true;
            this.controls.enabled = false;
        }

        // 5. Configurar letrero de instrucciones
        const instr = document.getElementById('instructions-overlay');
        if (instr) {
            if (this.placedModel) {
                instr.style.opacity = '0';
            } else {
                instr.style.opacity = '1';
                instr.textContent = 'Toca la pantalla para colocar el modelo sobre el suelo...';
            }
        }

        this.showToast("AR Interactivo iniciado.");
    }

    /**
     * Termina la experiencia AR interactiva con video en iOS Safari
     */
    stopVideoAR() {
        this.videoArActive = false;
        this.gyroActive = false;
        this.initialOrientation = null;

        // 1. Detener la transmisión de la cámara
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        const video = document.getElementById('ar-video-background');
        if (video) {
            video.srcObject = null;
            video.style.display = 'none';
        }

        // 2. Restaurar clases de interfaz
        document.body.classList.remove('ar-active');
        const exitContainer = document.getElementById('exit-ar-container');
        if (exitContainer) {
            exitContainer.style.display = 'none';
        }
        const settingsBtn = document.getElementById('settings-button-container');
        if (settingsBtn) {
            settingsBtn.style.display = 'none';
        }
        const drawer = document.getElementById('control-drawer');
        if (drawer) {
            drawer.classList.remove('ar-visible');
        }

        // 3. Restaurar escena 3D
        this.gridHelper.visible = true;
        if (this.previousFog) {
            this.scene.fog = this.previousFog;
        }
        if (this.previousShadowMapEnabled !== undefined) {
            this.renderer.shadowMap.enabled = this.previousShadowMapEnabled;
        }

        // 4. Detener evento del giroscopio
        if (this.handleDeviceOrientationBound) {
            window.removeEventListener('deviceorientation', this.handleDeviceOrientationBound);
            this.handleDeviceOrientationBound = null;
        }

        // 5. Rehabilitar y reajustar controles orbitales de cámara
        this.controls.enabled = true;
        this.controls.reset();
        this.camera.position.set(0, 1.6, 2.5);
        this.controls.target.set(0, 0.5, 0);
        this.controls.update();

        // 6. Restaurar letrero de instrucciones
        const instr = document.getElementById('instructions-overlay');
        if (instr) {
            if (this.placedModel) {
                instr.style.opacity = '0';
            } else {
                instr.style.opacity = '1';
                instr.textContent = 'Haz clic en la cuadrícula para colocar el objeto seleccionado';
            }
        }

        this.showToast("Modo AR Interactivo cerrado.");
    }

    /**
     * Controlador del giroscopio para orientar la cámara en el modo Video AR
     */
    handleDeviceOrientation(event) {
        if (!this.videoArActive) return;

        const alpha = event.alpha;
        const beta = event.beta;
        const gamma = event.gamma;

        if (alpha === null || beta === null || gamma === null || isNaN(alpha) || isNaN(beta) || isNaN(gamma)) return;

        const alphaRad = THREE.MathUtils.degToRad(alpha);
        const betaRad = THREE.MathUtils.degToRad(beta);
        const gammaRad = THREE.MathUtils.degToRad(gamma);

        if (this.initialOrientation === null) {
            this.initialOrientation = {
                alpha: alphaRad,
                beta: betaRad,
                gamma: gammaRad
            };
            this.initialCameraQuaternion = this.camera.quaternion.clone();
            return;
        }

        const dAlpha = alphaRad - this.initialOrientation.alpha;
        const dBeta = betaRad - this.initialOrientation.beta;
        const dGamma = gammaRad - this.initialOrientation.gamma;

        // Mapear diferencias relativas de orientación del giroscopio a rotaciones 3D.
        // Pitch (beta) gira alrededor del eje X.
        // Yaw (alpha) gira alrededor del eje Y.
        // Roll (gamma) gira alrededor del eje Z (invertido).
        const euler = new THREE.Euler(dBeta, dAlpha, -dGamma, 'YXZ');
        const relativeQuat = new THREE.Quaternion().setFromEuler(euler);

        // Multiplicar la rotación inicial por la rotación calculada del giroscopio
        this.camera.quaternion.copy(this.initialCameraQuaternion).multiply(relativeQuat);
    }
}

// Inicializar la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    const app = new WebARApp();
    app.init().catch(console.error);
});
