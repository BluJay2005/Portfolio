        // Three.js Background with Wide Spaced Wireframe Shapes & Colorful Neon Outlines
        const container = document.getElementById('bg-canvas-container');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 700 ? 1 : 2));
        container.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        scene.add(ambientLight);

        const group = new THREE.Group();

        function createWireframeShape(geometry, colorHex) {
            const wireMat = new THREE.MeshBasicMaterial({
                color: colorHex,
                wireframe: true,
                transparent: true,
                opacity: 0.25
            });
            const mesh = new THREE.Mesh(geometry, wireMat);

            const edges = new THREE.EdgesGeometry(geometry);
            const lineMat = new THREE.LineBasicMaterial({
                color: colorHex,
                linewidth: 2
            });
            const wireframeOverlay = new THREE.LineSegments(edges, lineMat);
            mesh.add(wireframeOverlay);

            return mesh;
        }

        const geometries = [
            new THREE.IcosahedronGeometry(1.3, 0),
            new THREE.OctahedronGeometry(1.2, 0),
            new THREE.DodecahedronGeometry(1.1, 0),
            new THREE.TetrahedronGeometry(1.4, 0),
            new THREE.TorusKnotGeometry(0.9, 0.3, 64, 16)
        ];

        const colors = [0xd0f388, 0x38bdf8, 0xf6e05e, 0xf43f5e, 0x38bdf8, 0xd0f388, 0xf6e05e];

        const positions = [
            [-8, 4, -4],
            [9, -3, -6],
            [-10, -5, -3],
            [11, 5, -5],
            [-4, -7, -2],
            [6, -6, -4],
            [0, 6, -5]
        ];

        const isSmall = window.innerWidth < 700;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        positions.slice(0, isSmall ? 4 : positions.length).forEach((pos, i) => {
            const geo = geometries[i % geometries.length];
            const col = colors[i % colors.length];
            const shape = createWireframeShape(geo, col);

            shape.position.set(pos[0], pos[1], pos[2]);
            shape.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            shape.userData = {
                rotSpeedX: (Math.random() - 0.5) * 0.003,
                rotSpeedY: (Math.random() - 0.5) * 0.003
            };
            group.add(shape);
        });

        scene.add(group);
        camera.position.z = 8;

        function animate() {
            if (reduceMotion) { renderer.render(scene, camera); return; }
            if (document.hidden) { requestAnimationFrame(animate); return; }
            requestAnimationFrame(animate);

            group.children.forEach(child => {
                child.rotation.x += child.userData.rotSpeedX;
                child.rotation.y += child.userData.rotSpeedY;
            });

            renderer.render(scene, camera);
        }
        animate();

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
