import * as T from "three";
import { evaluatePrevis } from "./evaluate.js";
import { isActor, type PrevisObject, type PrevisPlan, type PrevisScene } from "./model.js";

type Rig = { root: T.Group; head?: T.Group; legs: T.Group[]; arms: Record<string, T.Group>; hands: Record<string, T.Group> };

function objectRig(object: PrevisObject): Rig {
    const root = new T.Group(); root.userData.objectId = object.id;
    const rig: Rig = { root, legs: [], arms: {}, hands: {} };
    const material = new T.MeshStandardMaterial({ color: object.color, roughness: 1 });
    const mesh = (geometry: T.BufferGeometry, at: number[], parent: T.Object3D = root, mat = material) => {
        const value = new T.Mesh(geometry, mat); value.position.set(at[0], at[1], at[2]);
        value.castShadow = value.receiveShadow = true; parent.add(value); return value;
    };
    if (!isActor(object)) {
        if (object.kind === "bridge") {
            mesh(new T.BoxGeometry(1, .1, 1), [0, 0, 0]);
            for (const side of [-.48, .48]) {
                mesh(new T.BoxGeometry(.04, .04, 1), [side, .4, 0]);
                for (const end of [-.45, .45]) mesh(new T.BoxGeometry(.04, .4, .04), [side, .2, end]);
            }
        } else if (object.kind === "slope") {
            const shape = new T.Shape(); shape.moveTo(-.5, -.5); shape.lineTo(.5, -.5); shape.lineTo(.5, .5); shape.closePath();
            const slope = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }); slope.translate(0, 0, -.5); mesh(slope, [0, 0, 0]);
        } else mesh(object.kind === "sphere" ? new T.SphereGeometry(.5, 16, 12) : new T.BoxGeometry(1, 1, 1), [0, 0, 0]);
        root.scale.fromArray(object.size);
        return rig;
    }
    const quad = object.kind === "quadruped", bodyY = quad ? .78 : .88, headY = quad ? 1.02 : 1.48;
    mesh(new T.CapsuleGeometry(.22 * object.build, quad ? .55 : .4, 6, 12), [0, bodyY, 0]).rotation.x = quad ? Math.PI / 2 : 0;
    rig.head = new T.Group(); rig.head.position.set(0, headY, quad ? .43 : 0); root.add(rig.head);
    mesh(new T.SphereGeometry(.23, 16, 12), [0, 0, 0], rig.head);
    const dark = new T.MeshStandardMaterial({ color: "#334155" });
    for (const x of [-.08, .08]) mesh(new T.SphereGeometry(.026, 8, 8), [x, .045, .21], rig.head, dark);
    if (object.kind !== "human") {
        mesh(new T.SphereGeometry(.1, 10, 8), [0, -.07, .22], rig.head);
        for (const x of [-.14, .14]) mesh(new T.CapsuleGeometry(.045, object.ears, 4, 8), [x, .2 + object.ears / 2, 0], rig.head);
        if (object.tail) mesh(new T.CapsuleGeometry(.045, object.tail, 4, 8), [0, quad ? .75 : .55, quad ? -.48 : -.22]).rotation.x = Math.PI / 3;
    }
    const limb = (at: number[], length: number) => {
        const joint = new T.Group(); joint.position.set(at[0], at[1], at[2]); root.add(joint);
        mesh(new T.CapsuleGeometry(.065, length - .13, 4, 10), [0, -length / 2, 0], joint);
        return joint;
    };
    for (const x of [-.13, .13]) {
        rig.legs.push(limb([x, quad ? .7 : .53, quad ? -.3 : 0], quad ? .65 : .5));
        if (quad) rig.legs.push(limb([x, .7, .3], .65));
    }
    for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
        const arm = limb([sign * (quad ? .2 : .29 * object.build), quad ? .75 : 1.15, quad ? .32 : 0], .5);
        // Quadruped front limbs also supply hand anchors for supported simple interactions.
        if (quad) arm.visible = false;
        const hand = new T.Group(); hand.position.y = -.5; arm.add(hand);
        rig.arms[side] = arm; rig.hands[side] = hand;
    }
    root.scale.setScalar(object.height / (quad ? 1.3 : 1.75));
    return rig;
}

export function createPrevisRenderer(canvas: HTMLCanvasElement, data: { scene: PrevisScene; plan: PrevisPlan }, width: number, height: number) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace;
    const world = new T.Scene(); world.background = new T.Color("#f1f5f9");
    const camera = new T.PerspectiveCamera(45, width / height, .01, 2000);
    world.add(new T.HemisphereLight("#ffffff", "#64748b", 2));
    const light = new T.DirectionalLight("#ffffff", 2.5); light.position.set(-5, 10, 8); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024); Object.assign(light.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 100 }); world.add(light);
    const rigs = new Map(data.scene.objects.map((object) => { const rig = objectRig(object); world.add(rig.root); return [object.id, rig]; }));
    const down = new T.Vector3(0, -1, 0);
    function render(seconds: number) {
        const state = evaluatePrevis(data.scene, data.plan, seconds);
        for (const object of data.scene.objects) {
            const rig = rigs.get(object.id)!, pose = state.poses[object.id];
            rig.root.position.fromArray(pose.position); rig.root.rotation.set(object.rotation[0], pose.yaw, object.rotation[2]);
            if (rig.head) rig.head.rotation.set(0, 0, 0);
            for (const limb of [...rig.legs, ...Object.values(rig.arms)]) limb.rotation.set(0, 0, 0);
            for (const arm of Object.values(rig.arms)) arm.visible = object.kind !== "quadruped";
        }
        for (const action of state.actions) {
            const rig = rigs.get(action.objectId)!;
            const phase = state.time - action.start + (action.phaseSeconds || 0);
            if (action.kind === "walk" || action.kind === "run") {
                const swing = Math.sin(phase * (action.kind === "run" ? 14 : 9)) * (action.kind === "run" ? .75 : .4);
                rig.legs.forEach((leg, i) => { leg.rotation.x = swing * (i % 2 ? -1 : 1); });
                rig.arms.left.rotation.x = -swing; rig.arms.right.rotation.x = swing;
            }
        }
        world.updateMatrixWorld(true);
        for (const action of state.actions) {
            const rig = rigs.get(action.objectId)!, arm = rig.arms[action.side];
            if (action.kind === "raise") arm.rotation.z = (action.side === "left" ? 1 : -1) * 2.7 * T.MathUtils.smoothstep(state.time - action.start + (action.phaseSeconds || 0), 0, Math.min(.5, action.end - action.start + (action.phaseSeconds || 0)));
            if (action.kind === "hold") arm.rotation.x = -1.3;
            if (action.target && ["look", "point", "touch", "give"].includes(action.kind)) {
                const target = rigs.get(action.target)!, targetObject = data.scene.objects.find((o) => o.id === action.target)!;
                const point = target.root.getWorldPosition(new T.Vector3());
                if (isActor(targetObject)) point.y += targetObject.height * .6;
                if (action.kind === "look" && rig.head) {
                    const local = rig.root.worldToLocal(point.clone()); rig.head.rotation.y = Math.atan2(local.x, local.z);
                } else {
                    arm.visible = true;
                    const local = rig.root.worldToLocal(point).sub(arm.position).normalize(); arm.quaternion.setFromUnitVectors(down, local);
                }
            }
        }
        world.updateMatrixWorld(true);
        for (const event of state.attachments.values()) {
            const root = rigs.get(event.objectId)!.root;
            if (!event.parentId) { root.position.fromArray(event.position!); continue; }
            const hand = rigs.get(event.parentId)!.hands[event.hand];
            root.position.copy(hand.localToWorld(new T.Vector3(...event.offset)));
            root.quaternion.copy(hand.getWorldQuaternion(new T.Quaternion()));
        }
        camera.position.fromArray(state.camera.position); camera.fov = state.camera.fov;
        camera.lookAt(new T.Vector3(...state.camera.target)); camera.updateProjectionMatrix();
        renderer.render(world, camera); return state;
    }
    return {
        render,
        resize(w: number, h: number) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        pick(x: number, y: number) {
            const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x, y), camera);
            let object: T.Object3D | undefined = ray.intersectObjects(world.children, true)[0]?.object;
            while (object && !object.userData.objectId) object = object.parent || undefined;
            return object?.userData.objectId as string | undefined;
        },
        dispose() {
            const materials = new Set<T.Material>();
            world.traverse((object) => { if (object instanceof T.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material)); } });
            materials.forEach((material) => material.dispose()); renderer.dispose(); renderer.forceContextLoss();
        },
    };
}
