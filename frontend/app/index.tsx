import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  View, 
  StyleSheet, 
  StatusBar, 
  SafeAreaView, 
  Text, 
  TouchableOpacity, 
  Modal, 
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Line, Circle, G } from 'react-native-svg';

// ============================================
// GAME CONSTANTS - Tuned for MAXIMUM DOPAMINE
// ============================================
const DIAMOND_SIZE_RATIO = 0.28;
const BASE_SPEED = 0.00028;
const WAVE_DURATION = 18000;
const GRID_SPACING = 52;

// TRON Color Palette
const C = {
  void: '#000000',
  bg: '#020206',
  cyan: '#00FFFF',
  cyanBright: '#00E5FF',
  cyanDim: 'rgba(0, 255, 255, 0.15)',
  cyanFaint: 'rgba(0, 255, 255, 0.06)',
  magenta: '#FF00FF',
  magentaDim: 'rgba(255, 0, 255, 0.15)',
  gold: '#FFD700',
  white: '#FFFFFF',
  red: '#FF4444',
  gridLine: 'rgba(0, 255, 255, 0.03)',
  textMuted: '#445566',
  hudBg: 'rgba(0, 255, 255, 0.04)',
  hudBorder: 'rgba(0, 255, 255, 0.12)',
};

const TARGET_TYPES = {
  STANDARD: 'standard',
  CORNER_LOCK: 'corner_lock',
  DUAL: 'dual',
  FRACTURE: 'fracture',
  SHARD: 'shard'
};

const GameState = {
  MENU: 0,
  PLAYING: 1,
  GAME_OVER: 2,
  VICTORY: 3
};

interface Target {
  id: string;
  type: string;
  progress: number;
  hitZone: number;
  active: boolean;
  size?: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function getTrackPosition(progress: number, centerX: number, centerY: number, size: number) {
  const vertices = [
    { x: centerX, y: centerY - size },
    { x: centerX + size, y: centerY },
    { x: centerX, y: centerY + size },
    { x: centerX - size, y: centerY }
  ];
  
  const segment = Math.floor(progress * 4) % 4;
  const segmentProgress = (progress * 4) % 1;
  const start = vertices[segment];
  const end = vertices[(segment + 1) % 4];
  
  return {
    x: start.x + (end.x - start.x) * segmentProgress,
    y: start.y + (end.y - start.y) * segmentProgress,
  };
}

// ============================================
// MAIN GAME COMPONENT
// ============================================
export default function OrbitSyncGame() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  
  const [gameState, setGameState] = useState(GameState.MENU);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [lives, setLives] = useState(3);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [combo, setCombo] = useState(0);
  const [perfectHits, setPerfectHits] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [currentWave, setCurrentWave] = useState(1);
  const [bossHP, setBossHP] = useState(100);
  const [playerProgress, setPlayerProgress] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [showReviveModal, setShowReviveModal] = useState(false);
  const [showDoubleCoinsModal, setShowDoubleCoinsModal] = useState(false);
  const [canRevive, setCanRevive] = useState(true);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const [hitEffects, setHitEffects] = useState<{id: string, x: number, y: number, type: string}[]>([]);
  const [tick, setTick] = useState(0);
  
  const lastTimeRef = useRef(Date.now());
  const waveTimerRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const targetIdRef = useRef(0);
  const playerProgressRef = useRef(0);
  
  const centerX = screenWidth / 2;
  const centerY = screenHeight / 2 + 20;
  const diamondSize = Math.min(screenWidth, screenHeight) * DIAMOND_SIZE_RATIO;

  // Diamond vertices
  const vertices = useMemo(() => [
    { x: centerX, y: centerY - diamondSize },
    { x: centerX + diamondSize, y: centerY },
    { x: centerX, y: centerY + diamondSize },
    { x: centerX - diamondSize, y: centerY }
  ], [centerX, centerY, diamondSize]);

  // Diamond edges for SVG line rendering
  const edges = useMemo(() => {
    return vertices.map((start, i) => ({
      start,
      end: vertices[(i + 1) % 4],
    }));
  }, [vertices]);

  // Grid lines for Tron background
  const gridLines = useMemo(() => {
    const hLines: number[] = [];
    const vLines: number[] = [];
    for (let y = 0; y <= screenHeight; y += GRID_SPACING) hLines.push(y);
    for (let x = 0; x <= screenWidth; x += GRID_SPACING) vLines.push(x);
    return { hLines, vLines };
  }, [screenWidth, screenHeight]);

  const getSpawnInterval = useCallback(() => {
    switch (currentWave) {
      case 1: return 2200;
      case 2: return 1800;
      case 3: return 1400;
      case 4: return 1100;
      default: return 1800;
    }
  }, [currentWave]);

  const spawnTarget = useCallback((type: string, progress: number) => {
    const id = `target-${targetIdRef.current++}`;
    const target: Target = {
      id,
      type,
      progress,
      hitZone: type === TARGET_TYPES.CORNER_LOCK ? 0.030 : 
               type === TARGET_TYPES.FRACTURE ? 0.038 : 0.034,
      active: true,
      size: type === TARGET_TYPES.SHARD ? 0.6 + Math.random() * 0.4 : 1
    };
    setTargets(prev => [...prev, target]);
  }, []);

  const spawnShards = useCallback((progress: number) => {
    const shardCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < shardCount; i++) {
      const offset = 0.06 + i * 0.045;
      setTimeout(() => {
        spawnTarget(TARGET_TYPES.SHARD, (progress + offset) % 1);
      }, i * 120);
    }
  }, [spawnTarget]);

  const spawnWaveTarget = useCallback((currentProgress: number, wave: number) => {
    const aheadProgress = (currentProgress + 0.30 + Math.random() * 0.10) % 1;
    
    switch (wave) {
      case 1:
        if (Math.random() < 0.22) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      
      case 2: {
        const rand2 = Math.random();
        if (rand2 < 0.18) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
        } else if (rand2 < 0.42) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      }
      
      case 3: {
        const rand3 = Math.random();
        if (rand3 < 0.14) {
          spawnTarget(TARGET_TYPES.FRACTURE, aheadProgress);
        } else if (rand3 < 0.32) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else if (rand3 < 0.48) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      }
      
      case 4: {
        const rand4 = Math.random();
        if (rand4 < 0.12) {
          spawnTarget(TARGET_TYPES.FRACTURE, aheadProgress);
        } else if (rand4 < 0.28) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
          setTimeout(() => {
            spawnTarget(TARGET_TYPES.DUAL, (cornerProgress + 0.09) % 1);
          }, 500);
        } else if (rand4 < 0.48) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      }
    }
  }, [spawnTarget]);

  const createHitEffect = useCallback((x: number, y: number, type: 'perfect' | 'miss') => {
    const id = `hit-${Date.now()}-${Math.random()}`;
    setHitEffects(prev => [...prev, { id, x, y, type }]);
    setTimeout(() => {
      setHitEffects(prev => prev.filter(e => e.id !== id));
    }, 400);
  }, []);

  const createFlash = useCallback((type: 'perfect' | 'miss') => {
    setFlashColor(type === 'perfect' ? 'rgba(0, 255, 255, 0.25)' : 'rgba(255, 0, 0, 0.4)');
    setTimeout(() => setFlashColor(null), 100);
  }, []);

  const handleMiss = useCallback(() => {
    setCombo(0);
    setStreak(0);
    setTotalHits(prev => prev + 1);
    createHitEffect(centerX, centerY, 'miss');
    createFlash('miss');
    setLives(prev => {
      const newLives = prev - 1;
      if (newLives <= 0) {
        setGameState(GameState.GAME_OVER);
        if (canRevive) {
          setTimeout(() => setShowReviveModal(true), 700);
        }
      }
      return newLives;
    });
  }, [canRevive, createFlash, createHitEffect, centerX, centerY]);

  // Game loop
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    let animationId: number;
    
    const gameLoop = () => {
      const now = Date.now();
      const deltaTime = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const speedMultiplier = 1 + (currentWave - 1) * 0.15;
      playerProgressRef.current += BASE_SPEED * speedMultiplier * deltaTime;
      if (playerProgressRef.current >= 1) playerProgressRef.current -= 1;
      setPlayerProgress(playerProgressRef.current);

      waveTimerRef.current += deltaTime;
      if (waveTimerRef.current >= WAVE_DURATION && currentWave < 4) {
        setCurrentWave(prev => prev + 1);
        waveTimerRef.current = 0;
        createFlash('perfect');
        createHitEffect(centerX, centerY, 'perfect');
      }

      spawnTimerRef.current += deltaTime;
      if (spawnTimerRef.current >= getSpawnInterval()) {
        spawnTimerRef.current = 0;
        spawnWaveTarget(playerProgressRef.current, currentWave);
      }

      setTargets(prevTargets => {
        let shouldMiss = false;
        const newTargets = prevTargets.filter(target => {
          if (!target.active) return false;
          const dist = playerProgressRef.current - target.progress;
          if (dist > 0.09 && dist < 0.5) {
            shouldMiss = true;
            return false;
          }
          return true;
        });
        
        if (shouldMiss) {
          handleMiss();
        }
        
        return newTargets;
      });

      setTick(t => t + 1);
      animationId = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = Date.now();
    animationId = requestAnimationFrame(gameLoop);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [gameState, currentWave, getSpawnInterval, spawnWaveTarget, handleMiss, createFlash, createHitEffect, centerX, centerY]);

  const handleTap = useCallback(() => {
    if (gameState === GameState.MENU) {
      setGameState(GameState.PLAYING);
      setScore(0);
      setCoins(0);
      setLives(3);
      setStreak(0);
      setMaxStreak(0);
      setCombo(0);
      setPerfectHits(0);
      setTotalHits(0);
      setCurrentWave(1);
      setBossHP(100);
      setPlayerProgress(0);
      playerProgressRef.current = 0;
      setTargets([]);
      setCanRevive(true);
      waveTimerRef.current = 0;
      spawnTimerRef.current = 0;
      return;
    }

    if (gameState === GameState.GAME_OVER || gameState === GameState.VICTORY) {
      setGameState(GameState.MENU);
      return;
    }

    if (gameState !== GameState.PLAYING) return;

    let hitTarget: Target | null = null;
    let hitDistance = Infinity;
    const currentProgress = playerProgressRef.current;

    for (const target of targets) {
      if (!target.active) continue;
      const dist = Math.abs(currentProgress - target.progress);
      const wrapDist = Math.min(dist, 1 - dist);
      
      if (wrapDist < target.hitZone && wrapDist < hitDistance) {
        hitTarget = target;
        hitDistance = wrapDist;
      }
    }

    if (hitTarget) {
      const pos = getTrackPosition(hitTarget.progress, centerX, centerY, diamondSize);
      createHitEffect(pos.x, pos.y, 'perfect');
      createFlash('perfect');
      setTargets(prev => prev.filter(t => t.id !== hitTarget!.id));
      
      const isPerfect = hitDistance < hitTarget.hitZone * 0.5;
      const baseScore = isPerfect ? 1000 : 750;
      const comboMultiplier = 1 + Math.floor(combo / 8) * 0.15;
      const waveMultiplier = currentWave * 1.2;
      
      setScore(prev => prev + Math.floor(baseScore * comboMultiplier * waveMultiplier));
      setCoins(prev => prev + (isPerfect ? 18 : 12));
      setCombo(prev => prev + 1);
      setStreak(prev => {
        const newStreak = prev + 1;
        setMaxStreak(currentMax => Math.max(currentMax, newStreak));
        return newStreak;
      });
      setPerfectHits(prev => prev + 1);
      setTotalHits(prev => prev + 1);

      if (currentWave === 4) {
        setBossHP(prev => {
          const newHP = prev - (isPerfect ? 3 : 2);
          if (newHP <= 0) {
            setGameState(GameState.VICTORY);
            setScore(s => s + 50000);
            setCoins(c => c + 500);
            setTimeout(() => setShowDoubleCoinsModal(true), 700);
            return 0;
          }
          return newHP;
        });
      }

      if (hitTarget.type === TARGET_TYPES.FRACTURE) {
        spawnShards(hitTarget.progress);
      }
    }
  }, [gameState, targets, combo, currentWave, createFlash, createHitEffect, spawnShards, centerX, centerY, diamondSize]);

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(handleTap)();
  });

  const handleRevive = () => {
    setShowReviveModal(false);
    setLives(1);
    setCombo(0);
    setTargets([]);
    setGameState(GameState.PLAYING);
    setCanRevive(false);
    createFlash('perfect');
  };

  const handleDoubleCoins = () => {
    setShowDoubleCoinsModal(false);
    setCoins(prev => prev * 2);
    setScore(prev => prev + 10000);
  };

  const perfectPercent = totalHits > 0 ? Math.floor((perfectHits / totalHits) * 100) : 100;
  const playerPos = getTrackPosition(playerProgress, centerX, centerY, diamondSize);
  const pulseVal = Math.sin(tick * 0.12) * 0.5 + 0.5;

  // ============================================
  // RENDER TARGET
  // ============================================
  const renderTarget = (target: Target) => {
    const pos = getTrackPosition(target.progress, centerX, centerY, diamondSize);
    const pulse = 1 + Math.sin(tick * 0.15) * 0.06;
    const webGlow = Platform.OS === 'web';
    
    switch (target.type) {
      case TARGET_TYPES.STANDARD:
        return (
          <View key={target.id} style={{ position: 'absolute', left: pos.x - 28, top: pos.y - 28, width: 56, height: 56, justifyContent: 'center', alignItems: 'center' }}>
            {/* Glow */}
            <View style={{
              position: 'absolute', width: 56, height: 56, borderRadius: 28,
              backgroundColor: 'rgba(0, 255, 255, 0.1)',
            }} />
            {/* Ring */}
            <View style={[{
              width: 44 * pulse, height: 44 * pulse, borderRadius: 22 * pulse,
              borderWidth: 2.5, borderColor: C.cyan,
              backgroundColor: 'rgba(0, 255, 255, 0.06)',
              justifyContent: 'center', alignItems: 'center',
            }, webGlow ? { boxShadow: '0 0 12px rgba(0,255,255,0.4), inset 0 0 8px rgba(0,255,255,0.15)' } as any : {}]}>
              {/* Core dot */}
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: C.white }} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.CORNER_LOCK:
        return (
          <View key={target.id} style={{ position: 'absolute', left: pos.x - 30, top: pos.y - 30, width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0, 255, 255, 0.08)' }} />
            <View style={[{
              width: 46 * pulse, height: 46 * pulse, borderRadius: 8,
              borderWidth: 2.5, borderColor: C.cyan,
              transform: [{ rotate: '45deg' }],
              backgroundColor: 'rgba(0, 255, 255, 0.05)',
              justifyContent: 'center', alignItems: 'center',
            }, webGlow ? { boxShadow: '0 0 14px rgba(0,255,255,0.4)' } as any : {}]}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.white, transform: [{ rotate: '-45deg' }] }} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.DUAL:
        return (
          <View key={target.id} style={{ position: 'absolute', left: pos.x - 28, top: pos.y - 28, width: 56, height: 56, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255, 0, 255, 0.06)' }} />
            <View style={[{
              width: 44 * pulse, height: 44 * pulse, borderRadius: 22 * pulse,
              overflow: 'hidden', flexDirection: 'row',
              borderWidth: 2.5, borderColor: C.white,
            }, webGlow ? { boxShadow: '0 0 12px rgba(255,0,255,0.3), 0 0 12px rgba(0,255,255,0.3)' } as any : {}]}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0, 255, 255, 0.7)' }} />
              <View style={{ flex: 1, backgroundColor: 'rgba(255, 0, 255, 0.7)' }} />
            </View>
            <View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: C.white }} />
          </View>
        );
      
      case TARGET_TYPES.FRACTURE:
        return (
          <View key={target.id} style={{ position: 'absolute', left: pos.x - 30, top: pos.y - 30, width: 60, height: 60, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255, 215, 0, 0.08)' }} />
            <View style={[{
              width: 40 * pulse, height: 40 * pulse,
              transform: [{ rotate: '45deg' }],
              borderRadius: 4,
              borderWidth: 2.5, borderColor: C.gold,
              backgroundColor: 'rgba(255, 215, 0, 0.12)',
              justifyContent: 'center', alignItems: 'center',
            }, webGlow ? { boxShadow: '0 0 16px rgba(255,215,0,0.5)' } as any : {}]}>
              {/* Crack lines */}
              <View style={{ position: 'absolute', width: 2, height: 30, backgroundColor: C.gold, opacity: 0.6, transform: [{ rotate: '-45deg' }] }} />
              <View style={{ position: 'absolute', width: 30, height: 2, backgroundColor: C.gold, opacity: 0.6, transform: [{ rotate: '-45deg' }] }} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.SHARD: {
        const sz = 24 * (target.size || 1);
        return (
          <View key={target.id} style={{ position: 'absolute', left: pos.x - sz / 2, top: pos.y - sz / 2, width: sz, height: sz, justifyContent: 'center', alignItems: 'center' }}>
            <View style={[{
              width: sz * 0.75, height: sz * 0.75,
              transform: [{ rotate: '45deg' }, { scale: pulse }],
              borderRadius: 2,
              borderWidth: 2, borderColor: C.gold,
              backgroundColor: 'rgba(255, 215, 0, 0.2)',
            }, webGlow ? { boxShadow: '0 0 8px rgba(255,215,0,0.4)' } as any : {}]} />
          </View>
        );
      }
      
      default:
        return null;
    }
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <SafeAreaView style={styles.container}>
        <GestureDetector gesture={tapGesture}>
          <View style={styles.gameArea}>

            {/* ===== TRON GRID BACKGROUND ===== */}
            {gridLines.hLines.map((y, i) => (
              <View key={`hg-${i}`} style={{
                position: 'absolute', left: 0, right: 0, top: y,
                height: StyleSheet.hairlineWidth,
                backgroundColor: C.gridLine,
              }} />
            ))}
            {gridLines.vLines.map((x, i) => (
              <View key={`vg-${i}`} style={{
                position: 'absolute', top: 0, bottom: 0, left: x,
                width: StyleSheet.hairlineWidth,
                backgroundColor: C.gridLine,
              }} />
            ))}

            {/* ===== AMBIENT PARTICLES ===== */}
            {Array.from({ length: 25 }).map((_, i) => {
              const xPos = ((i * 41 + tick * 0.006) % screenWidth);
              const yPos = ((i * 59 + tick * 0.025) % screenHeight);
              const sz = 1 + (i % 3);
              return (
                <View key={`p-${i}`} style={{
                  position: 'absolute', left: xPos, top: yPos,
                  width: sz, height: sz, borderRadius: sz / 2,
                  backgroundColor: C.cyan,
                  opacity: 0.05 + (i % 5) * 0.02,
                }} />
              );
            })}

            {/* ===== RADIAL AMBIENT GLOW ===== */}
            <View style={{
              position: 'absolute',
              width: diamondSize * 3.2, height: diamondSize * 3.2,
              borderRadius: diamondSize * 1.6,
              left: centerX - diamondSize * 1.6,
              top: centerY - diamondSize * 1.6,
              backgroundColor: 'rgba(0, 255, 255, 0.012)',
            }} />

            {/* ===== BOSS SILHOUETTE ===== */}
            {currentWave === 4 && gameState === GameState.PLAYING && (
              <View style={{ position: 'absolute', top: screenHeight * 0.08, left: 0, right: 0, alignItems: 'center', opacity: 0.06 + pulseVal * 0.04 }}>
                <View style={{
                  width: 70, height: 100,
                  borderWidth: 2, borderColor: C.magenta,
                  transform: [{ rotate: '45deg' }],
                  borderRadius: 6,
                }} />
              </View>
            )}

            {/* ===== DIAMOND TRACK (SVG) ===== */}
            <Svg
              width={screenWidth}
              height={screenHeight}
              style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
            >
              {/* Track edge glow layers */}
              {edges.map((e, i) => (
                <G key={`edge-${i}`}>
                  {/* Widest outer glow */}
                  <Line
                    x1={e.start.x} y1={e.start.y}
                    x2={e.end.x} y2={e.end.y}
                    stroke="rgba(0, 255, 255, 0.03)"
                    strokeWidth={48}
                    strokeLinecap="round"
                  />
                  {/* Outer glow */}
                  <Line
                    x1={e.start.x} y1={e.start.y}
                    x2={e.end.x} y2={e.end.y}
                    stroke="rgba(0, 255, 255, 0.06)"
                    strokeWidth={24}
                    strokeLinecap="round"
                  />
                  {/* Inner glow */}
                  <Line
                    x1={e.start.x} y1={e.start.y}
                    x2={e.end.x} y2={e.end.y}
                    stroke="rgba(0, 255, 255, 0.14)"
                    strokeWidth={10}
                    strokeLinecap="round"
                  />
                  {/* Core line */}
                  <Line
                    x1={e.start.x} y1={e.start.y}
                    x2={e.end.x} y2={e.end.y}
                    stroke="#00E5FF"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  {/* Bright center highlight */}
                  <Line
                    x1={e.start.x} y1={e.start.y}
                    x2={e.end.x} y2={e.end.y}
                    stroke="rgba(255, 255, 255, 0.35)"
                    strokeWidth={1}
                    strokeLinecap="round"
                  />
                </G>
              ))}

              {/* Corner nodes */}
              {vertices.map((v, i) => (
                <G key={`cn-${i}`}>
                  <Circle cx={v.x} cy={v.y} r={18} fill="rgba(0, 255, 255, 0.06)" />
                  <Circle cx={v.x} cy={v.y} r={10} fill="rgba(0, 255, 255, 0.18)" />
                  <Circle cx={v.x} cy={v.y} r={5} fill="#00E5FF" />
                  <Circle cx={v.x} cy={v.y} r={2.5} fill="#FFFFFF" />
                </G>
              ))}
            </Svg>

            {/* ===== PLAYER TRAIL ===== */}
            {gameState === GameState.PLAYING && [0.012, 0.026, 0.042, 0.06].map((offset, i) => {
              const trailProg = (playerProgress - offset + 1) % 1;
              const trailPos = getTrackPosition(trailProg, centerX, centerY, diamondSize);
              const sz = 8 - i * 1.5;
              const op = 0.35 - i * 0.08;
              return (
                <View key={`trail-${i}`} style={{
                  position: 'absolute',
                  width: sz, height: sz, borderRadius: sz / 2,
                  left: trailPos.x - sz / 2, top: trailPos.y - sz / 2,
                  backgroundColor: C.cyan, opacity: Math.max(op, 0.04),
                }} />
              );
            })}

            {/* ===== PLAYER ORB ===== */}
            {gameState === GameState.PLAYING && (
              <>
                {/* Outer pulse */}
                <View style={[{
                  position: 'absolute',
                  width: 52, height: 52, borderRadius: 26,
                  left: playerPos.x - 26, top: playerPos.y - 26,
                  backgroundColor: 'rgba(0, 255, 255, 0.07)',
                }, Platform.OS === 'web' ? { boxShadow: '0 0 30px rgba(0,255,255,0.15)' } as any : {}]} />
                {/* Mid glow */}
                <View style={{
                  position: 'absolute',
                  width: 34, height: 34, borderRadius: 17,
                  left: playerPos.x - 17, top: playerPos.y - 17,
                  backgroundColor: 'rgba(0, 255, 255, 0.2)',
                }} />
                {/* Inner glow */}
                <View style={{
                  position: 'absolute',
                  width: 22, height: 22, borderRadius: 11,
                  left: playerPos.x - 11, top: playerPos.y - 11,
                  backgroundColor: 'rgba(0, 255, 255, 0.45)',
                }} />
                {/* Core */}
                <View style={[{
                  position: 'absolute',
                  width: 14, height: 14, borderRadius: 7,
                  left: playerPos.x - 7, top: playerPos.y - 7,
                  backgroundColor: C.white,
                }, Platform.OS === 'web' ? { boxShadow: '0 0 10px rgba(255,255,255,0.6), 0 0 20px rgba(0,255,255,0.4)' } as any : {}]} />
              </>
            )}

            {/* ===== TARGETS ===== */}
            {gameState === GameState.PLAYING && targets.map(renderTarget)}

            {/* ===== HIT EFFECTS ===== */}
            {hitEffects.map(effect => (
              <React.Fragment key={effect.id}>
                {/* Outer ring */}
                <View style={{
                  position: 'absolute',
                  width: 90, height: 90, borderRadius: 45,
                  left: effect.x - 45, top: effect.y - 45,
                  borderWidth: 2.5,
                  borderColor: effect.type === 'perfect' ? 'rgba(0,255,255,0.5)' : 'rgba(255,68,68,0.5)',
                  backgroundColor: effect.type === 'perfect' ? 'rgba(0,255,255,0.04)' : 'rgba(255,68,68,0.04)',
                }} />
                {/* Inner ring */}
                <View style={{
                  position: 'absolute',
                  width: 50, height: 50, borderRadius: 25,
                  left: effect.x - 25, top: effect.y - 25,
                  borderWidth: 1.5,
                  borderColor: effect.type === 'perfect' ? 'rgba(0,255,255,0.7)' : 'rgba(255,68,68,0.7)',
                }} />
              </React.Fragment>
            ))}

            {/* ===== FLASH OVERLAY ===== */}
            {flashColor && <View style={[styles.flash, { backgroundColor: flashColor }]} />}

            {/* ===== HUD ===== */}
            {gameState === GameState.PLAYING && (
              <>
                {/* Top HUD Bar */}
                <View style={styles.topHUD}>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelGold}>COINS</Text>
                    <Text style={styles.valueGold}>{coins.toLocaleString()}</Text>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelCyan}>LIVES</Text>
                    <View style={styles.livesRow}>
                      {[0, 1, 2].map(i => (
                        <Text key={i} style={{ fontSize: 20, color: i < lives ? C.cyan : '#1a1a2e', textShadowColor: i < lives ? 'rgba(0,255,255,0.5)' : 'transparent', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } }}>{"\u2665"}</Text>
                      ))}
                    </View>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelMagenta}>STREAK</Text>
                    <Text style={styles.valueWhite}>x{streak}</Text>
                  </View>
                </View>

                {/* Wave / Boss Bar */}
                <View style={styles.waveBar}>
                  {currentWave === 4 ? (
                    <>
                      <Text style={styles.bossName}>{"\u25C6"} GRID SENTINEL {"\u25C6"}</Text>
                      <View style={styles.hpBarOuter}>
                        <View style={[styles.hpFill, { width: `${bossHP}%` }]} />
                        <View style={styles.hpShine} />
                      </View>
                      <Text style={styles.bossPhase}>BOSS BATTLE</Text>
                    </>
                  ) : (
                    <Text style={styles.waveText}>WAVE {currentWave} / 4</Text>
                  )}
                </View>

                {/* Center Score Display */}
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                  <Text style={styles.scoreValue}>{score.toLocaleString()}</Text>
                  <Text style={styles.stageText}>STAGE 1-{currentWave}</Text>
                  <Text style={styles.worldText}>WORLD 1 {"\u00B7"} NEURAL AWAKENING</Text>
                </View>

                {/* Bottom HUD */}
                <View style={styles.bottomHUD}>
                  <View style={styles.hudCol}>
                    <Text style={styles.smallLabel}>COMBO</Text>
                    <Text style={[styles.comboVal, { color: combo > 0 ? C.cyan : '#1a2a3a', textShadowColor: combo > 0 ? 'rgba(0,255,255,0.4)' : 'transparent', textShadowRadius: combo > 0 ? 8 : 0, textShadowOffset: { width: 0, height: 0 } }]}>{combo}</Text>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.smallLabel}>PERFECT</Text>
                    <Text style={styles.perfectVal}>{perfectPercent}%</Text>
                  </View>
                </View>

                {/* Tap hint */}
                <Text style={[styles.tapHint, { opacity: 0.15 + pulseVal * 0.15 }]}>TAP ANYWHERE</Text>
              </>
            )}

            {/* ===== MENU SCREEN ===== */}
            {gameState === GameState.MENU && (
              <View style={styles.overlay}>
                {/* Decorative top line */}
                <View style={{ width: 120, height: 1, backgroundColor: 'rgba(0,255,255,0.3)', marginBottom: 20 }} />
                <Text style={styles.titleSmall}>{"\u25C7"} RHYTHM REACTOR {"\u25C7"}</Text>
                <Text style={[styles.title, Platform.OS === 'web' ? { textShadow: '0 0 30px rgba(0,255,255,0.5), 0 0 60px rgba(0,255,255,0.2)' } as any : { textShadowColor: 'rgba(0,255,255,0.5)', textShadowRadius: 20, textShadowOffset: { width: 0, height: 0 } }]}>ORBIT SYNC</Text>
                {/* Decorative bottom line */}
                <View style={{ width: 200, height: 1, backgroundColor: 'rgba(0,255,255,0.2)', marginTop: 12 }} />
                <Text style={styles.subtitle}>WORLD 1 {"\u00B7"} NEURAL AWAKENING</Text>
                <Text style={[styles.tapStart, { opacity: 0.5 + pulseVal * 0.5 }]}>TAP TO START</Text>
              </View>
            )}

            {/* ===== GAME OVER ===== */}
            {gameState === GameState.GAME_OVER && !showReviveModal && (
              <View style={styles.darkOverlay}>
                <View style={{ width: 80, height: 1, backgroundColor: 'rgba(255,68,68,0.4)', marginBottom: 16 }} />
                <Text style={[styles.gameOverTitle, Platform.OS === 'web' ? { textShadow: '0 0 20px rgba(255,68,68,0.5)' } as any : { textShadowColor: 'rgba(255,68,68,0.5)', textShadowRadius: 15, textShadowOffset: { width: 0, height: 0 } }]}>GAME OVER</Text>
                <View style={{ width: 140, height: 1, backgroundColor: 'rgba(255,68,68,0.2)', marginTop: 10, marginBottom: 30 }} />
                <Text style={styles.finalScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.finalCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.finalStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={[styles.tapStart, { opacity: 0.5 + pulseVal * 0.5 }]}>TAP TO RESTART</Text>
              </View>
            )}

            {/* ===== VICTORY ===== */}
            {gameState === GameState.VICTORY && !showDoubleCoinsModal && (
              <View style={styles.darkOverlay}>
                <View style={{ width: 80, height: 1, backgroundColor: 'rgba(0,255,255,0.4)', marginBottom: 16 }} />
                <Text style={[styles.victoryTitle, Platform.OS === 'web' ? { textShadow: '0 0 30px rgba(0,255,255,0.6)' } as any : { textShadowColor: 'rgba(0,255,255,0.5)', textShadowRadius: 20, textShadowOffset: { width: 0, height: 0 } }]}>VICTORY!</Text>
                <Text style={styles.victoryBoss}>GRID SENTINEL DEFEATED</Text>
                <View style={{ width: 140, height: 1, backgroundColor: 'rgba(0,255,255,0.2)', marginTop: 10, marginBottom: 30 }} />
                <Text style={styles.finalScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.finalCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.finalStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={[styles.tapStart, { opacity: 0.5 + pulseVal * 0.5 }]}>TAP TO CONTINUE</Text>
              </View>
            )}

          </View>
        </GestureDetector>

        {/* ===== REVIVE MODAL ===== */}
        <Modal visible={showReviveModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalBox}>
              <View style={{ width: 60, height: 1, backgroundColor: 'rgba(255,0,255,0.4)', marginBottom: 16 }} />
              <Text style={styles.modalTitle}>CONTINUE?</Text>
              <Text style={styles.modalSub}>Signal lost. Systems failing.</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>SCORE</Text>
                  <Text style={styles.statVal}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>COINS</Text>
                  <Text style={[styles.statVal, { color: C.gold }]}>{coins}</Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.reviveBtn, Platform.OS === 'web' ? { boxShadow: '0 0 20px rgba(255,0,255,0.3)' } as any : {}]} onPress={handleRevive}>
                <Ionicons name="heart" size={20} color="#fff" />
                <Text style={styles.reviveTxt}>REVIVE</Text>
                <Text style={styles.adTxt}>Watch Ad</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => setShowReviveModal(false)}>
                <Text style={styles.skipTxt}>No Thanks</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ===== VICTORY MODAL ===== */}
        <Modal visible={showDoubleCoinsModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={[styles.modalBox, styles.victoryBox]}>
              <View style={{ width: 60, height: 1, backgroundColor: 'rgba(0,255,255,0.4)', marginBottom: 16 }} />
              <Text style={[styles.modalTitle, { color: C.cyan }]}>VICTORY!</Text>
              <Text style={styles.modalSub}>Grid Sentinel has been neutralized.</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>FINAL SCORE</Text>
                  <Text style={styles.statVal}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>COINS</Text>
                  <Text style={[styles.statVal, { color: C.gold }]}>{coins}</Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.doubleBtn, Platform.OS === 'web' ? { boxShadow: '0 0 20px rgba(255,215,0,0.3)' } as any : {}]} onPress={handleDoubleCoins}>
                <Ionicons name="sparkles" size={20} color="#000" />
                <Text style={styles.doubleTxt}>DOUBLE COINS!</Text>
                <Text style={styles.adTxtDark}>Watch Ad</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => setShowDoubleCoinsModal(false)}>
                <Text style={styles.skipTxt}>Collect {coins} coins</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ============================================
// STYLES - Premium Tron Aesthetic
// ============================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  gameArea: { flex: 1, backgroundColor: '#000' },
  
  flash: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 999,
  },
  
  // ===== HUD =====
  topHUD: {
    position: 'absolute',
    top: 14,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  hudCol: { alignItems: 'center' },
  labelGold: {
    fontSize: 10,
    fontWeight: '700',
    color: C.gold,
    letterSpacing: 2,
    marginBottom: 4,
  },
  valueGold: {
    fontSize: 22,
    fontWeight: '800',
    color: C.gold,
    letterSpacing: 1,
  },
  labelCyan: {
    fontSize: 10,
    fontWeight: '700',
    color: C.cyan,
    letterSpacing: 2,
    marginBottom: 4,
  },
  labelMagenta: {
    fontSize: 10,
    fontWeight: '700',
    color: C.magenta,
    letterSpacing: 2,
    marginBottom: 4,
  },
  valueWhite: {
    fontSize: 22,
    fontWeight: '800',
    color: C.white,
    letterSpacing: 1,
  },
  livesRow: { flexDirection: 'row', gap: 6 },
  
  // ===== Wave / Boss Bar =====
  waveBar: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  waveText: {
    fontSize: 12,
    color: '#445566',
    fontWeight: '700',
    letterSpacing: 3,
  },
  bossName: {
    fontSize: 11,
    color: C.magenta,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 6,
  },
  hpBarOuter: {
    width: '65%',
    height: 10,
    backgroundColor: 'rgba(255, 0, 255, 0.08)',
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 255, 0.4)',
  },
  hpFill: {
    height: '100%',
    backgroundColor: C.magenta,
    borderRadius: 5,
  },
  hpShine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  bossPhase: {
    fontSize: 9,
    color: 'rgba(255, 0, 255, 0.5)',
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 5,
  },
  
  // ===== Score Box =====
  scoreBox: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -52,
    alignItems: 'center',
    zIndex: 50,
  },
  scoreLabel: {
    fontSize: 11,
    color: '#334455',
    fontWeight: '700',
    letterSpacing: 4,
  },
  scoreValue: {
    fontSize: 46,
    color: C.white,
    fontWeight: '800',
    letterSpacing: 2,
  },
  stageText: {
    fontSize: 11,
    color: '#334455',
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: 4,
  },
  worldText: {
    fontSize: 9,
    color: '#223344',
    fontWeight: '600',
    letterSpacing: 2,
    marginTop: 3,
  },
  
  // ===== Bottom HUD =====
  bottomHUD: {
    position: 'absolute',
    bottom: 58,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  smallLabel: {
    fontSize: 10,
    color: '#445566',
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 4,
  },
  comboVal: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
  },
  perfectVal: {
    fontSize: 24,
    fontWeight: '800',
    color: C.magenta,
    letterSpacing: 1,
  },
  tapHint: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 10,
    color: '#334455',
    fontWeight: '600',
    letterSpacing: 4,
  },
  
  // ===== Overlays =====
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 200,
  },
  darkOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    zIndex: 200,
  },
  titleSmall: {
    fontSize: 11,
    color: 'rgba(0, 255, 255, 0.5)',
    fontWeight: '600',
    letterSpacing: 5,
    marginBottom: 8,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: C.white,
    letterSpacing: 6,
  },
  subtitle: {
    fontSize: 13,
    color: C.cyan,
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: 20,
  },
  tapStart: {
    fontSize: 16,
    fontWeight: '700',
    color: C.white,
    letterSpacing: 4,
    marginTop: 50,
  },
  gameOverTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: C.red,
    letterSpacing: 4,
  },
  victoryTitle: {
    fontSize: 44,
    fontWeight: '900',
    color: C.cyan,
    letterSpacing: 4,
  },
  victoryBoss: {
    fontSize: 13,
    color: C.magenta,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 10,
  },
  finalScore: {
    fontSize: 18,
    color: C.white,
    fontWeight: '600',
    letterSpacing: 1,
  },
  finalCoins: {
    fontSize: 16,
    color: C.gold,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 10,
  },
  finalStreak: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 8,
  },
  
  // ===== Modals =====
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#060610',
    borderRadius: 20,
    padding: 32,
    width: '92%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 0, 255, 0.3)',
  },
  victoryBox: {
    borderColor: 'rgba(0, 255, 255, 0.3)',
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: C.magenta,
    letterSpacing: 3,
    marginBottom: 8,
  },
  modalSub: {
    fontSize: 13,
    color: '#556677',
    fontWeight: '500',
    letterSpacing: 1,
    marginBottom: 26,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 28,
  },
  statCol: { alignItems: 'center' },
  statLabel: {
    fontSize: 9,
    color: '#556677',
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  statVal: {
    fontSize: 24,
    fontWeight: '800',
    color: C.white,
    letterSpacing: 1,
  },
  reviveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.magenta,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 28,
    marginBottom: 14,
    gap: 10,
  },
  reviveTxt: {
    fontSize: 18,
    fontWeight: '800',
    color: C.white,
    letterSpacing: 2,
  },
  adTxt: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
    marginLeft: 4,
  },
  doubleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.gold,
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 28,
    marginBottom: 14,
    gap: 8,
  },
  doubleTxt: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 2,
  },
  adTxtDark: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.5)',
    fontWeight: '500',
  },
  skipBtn: {
    paddingVertical: 14,
    paddingHorizontal: 30,
  },
  skipTxt: {
    fontSize: 13,
    color: '#445566',
    fontWeight: '500',
    letterSpacing: 1,
  },
});
