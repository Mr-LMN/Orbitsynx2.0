import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  View, 
  StyleSheet, 
  StatusBar, 
  SafeAreaView, 
  Text, 
  TouchableOpacity, 
  Modal, 
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================
// GAME CONSTANTS - Tuned for MAXIMUM DOPAMINE
// ============================================
const DIAMOND_SIZE_RATIO = 0.28;
const BASE_SPEED = 0.00028;
const WAVE_DURATION = 18000;

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
  // Use useWindowDimensions hook for proper dimension updates on web
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

  // Generate track segments for rendering - FEWER, BIGGER
  const trackSegments = useMemo(() => {
    const segments: { x: number; y: number }[] = [];
    const totalPoints = 48; // Much fewer dots
    
    for (let i = 0; i < totalPoints; i++) {
      const progress = i / totalPoints;
      const pos = getTrackPosition(progress, centerX, centerY, diamondSize);
      segments.push({ x: pos.x, y: pos.y });
    }
    
    return segments;
  }, [centerX, centerY, diamondSize]);

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
      
      case 2:
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
      
      case 3:
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
      
      case 4:
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
  }, [spawnTarget]);

  const createHitEffect = useCallback((x: number, y: number, type: 'perfect' | 'miss') => {
    const id = `hit-${Date.now()}-${Math.random()}`;
    setHitEffects(prev => [...prev, { id, x, y, type }]);
    setTimeout(() => {
      setHitEffects(prev => prev.filter(e => e.id !== id));
    }, 400);
  }, []);

  const createFlash = useCallback((type: 'perfect' | 'miss') => {
    setFlashColor(type === 'perfect' ? 'rgba(0, 255, 255, 0.35)' : 'rgba(255, 0, 0, 0.5)');
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

  const renderTarget = (target: Target) => {
    const pos = getTrackPosition(target.progress, centerX, centerY, diamondSize);
    const pulseScale = 1 + Math.sin(tick * 0.15) * 0.08;
    
    switch (target.type) {
      case TARGET_TYPES.STANDARD:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 26, top: pos.y - 26, width: 52, height: 52 }]}>
            <View style={[styles.standardOuter, { transform: [{ scale: pulseScale }] }]}>
              <View style={styles.standardInner} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.CORNER_LOCK:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 28, top: pos.y - 28, width: 56, height: 56 }]}>
            <View style={[styles.cornerOuter, { transform: [{ scale: pulseScale }] }]}>
              <View style={styles.cornerInnerDot} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.DUAL:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 26, top: pos.y - 26, width: 52, height: 52 }]}>
            <View style={[styles.dualOuter, { transform: [{ scale: pulseScale }] }]}>
              <View style={styles.dualLeft} />
              <View style={styles.dualRight} />
              <View style={styles.dualSeam} />
              <View style={styles.dualCenter} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.FRACTURE:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 28, top: pos.y - 28, width: 56, height: 56 }]}>
            <View style={[styles.fractureOuter, { transform: [{ scale: pulseScale }] }]}>
              <View style={styles.fractureCrack1} />
              <View style={styles.fractureCrack2} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.SHARD:
        const size = 22 * (target.size || 1);
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - size/2, top: pos.y - size/2, width: size, height: size }]}>
            <View style={[styles.shardOuter, { width: size - 4, height: size - 4, transform: [{ scale: pulseScale }] }]} />
          </View>
        );
      
      default:
        return null;
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <SafeAreaView style={styles.container}>
        <GestureDetector gesture={tapGesture}>
          <View style={styles.gameArea}>
            {/* Animated background particles */}
            {Array.from({ length: 40 }).map((_, i) => {
              const xPos = ((i * 37 + tick * 0.01) % screenWidth);
              const yPos = ((i * 53 + tick * 0.06) % screenHeight);
              return (
                <View
                  key={`bg-${i}`}
                  style={[
                    styles.bgParticle,
                    {
                      left: xPos,
                      top: yPos,
                      width: (i % 3) + 2,
                      height: (i % 3) + 2,
                      opacity: 0.12 + (i % 5) * 0.06,
                    }
                  ]}
                />
              );
            })}

            {/* Boss silhouette */}
            {currentWave === 4 && gameState === GameState.PLAYING && (
              <View style={styles.bossContainer}>
                <View style={styles.bossCrystal} />
              </View>
            )}

            {/* DIAMOND TRACK - Glow layer */}
            {trackSegments.map((point, i) => (
              <View
                key={`glow-${i}`}
                style={[
                  styles.trackGlow,
                  { left: point.x - 16, top: point.y - 16 }
                ]}
              />
            ))}

            {/* DIAMOND TRACK - Main dots */}
            {trackSegments.map((point, i) => (
              <View
                key={`dot-${i}`}
                style={[
                  styles.trackMain,
                  { left: point.x - 8, top: point.y - 8 }
                ]}
              />
            ))}

            {/* Corner nodes with glow */}
            {vertices.map((v, i) => (
              <React.Fragment key={`corner-${i}`}>
                <View style={[styles.cornerGlow, { left: v.x - 18, top: v.y - 18 }]} />
                <View style={[styles.cornerNode, { left: v.x - 14, top: v.y - 14 }]}>
                  <View style={styles.cornerDot} />
                </View>
              </React.Fragment>
            ))}

            {/* Targets */}
            {gameState === GameState.PLAYING && targets.map(renderTarget)}

            {/* Player Orb with glow */}
            {gameState === GameState.PLAYING && (
              <>
                <View style={[styles.playerGlowOuter, { left: playerPos.x - 28, top: playerPos.y - 28 }]} />
                <View style={[styles.playerGlowInner, { left: playerPos.x - 22, top: playerPos.y - 22 }]} />
                <View style={[styles.playerCore, { left: playerPos.x - 14, top: playerPos.y - 14 }]} />
              </>
            )}

            {/* Hit Effects */}
            {hitEffects.map(effect => (
              <View 
                key={effect.id}
                style={[
                  styles.hitRing,
                  { 
                    left: effect.x - 50, 
                    top: effect.y - 50,
                    borderColor: effect.type === 'perfect' ? '#0ff' : '#f44',
                  }
                ]}
              />
            ))}

            {/* Flash overlay */}
            {flashColor && <View style={[styles.flash, { backgroundColor: flashColor }]} />}

            {/* HUD */}
            {gameState === GameState.PLAYING && (
              <>
                <View style={styles.topHUD}>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelGold}>COINS</Text>
                    <Text style={styles.valueGold}>{coins.toLocaleString()}</Text>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelCyan}>LIVES</Text>
                    <View style={styles.livesRow}>
                      {[0, 1, 2].map(i => (
                        <Text key={i} style={[styles.heart, { color: i < lives ? '#0ff' : '#333' }]}>{'\u2665'}</Text>
                      ))}
                    </View>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.labelMagenta}>STREAK</Text>
                    <Text style={styles.valueWhite}>x{streak}</Text>
                  </View>
                </View>

                <View style={styles.waveBar}>
                  {currentWave === 4 ? (
                    <>
                      <Text style={styles.bossName}>AETHELRED, PRISM WARDEN</Text>
                      <View style={styles.hpBar}>
                        <View style={[styles.hpFill, { width: `${bossHP}%` }]} />
                      </View>
                      <Text style={styles.bossPhase}>BOSS PHASE</Text>
                    </>
                  ) : (
                    <Text style={styles.waveText}>WAVE {currentWave} / 4</Text>
                  )}
                </View>

                <View style={styles.scoreBox}>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                  <Text style={styles.scoreValue}>{score.toLocaleString()}</Text>
                  <Text style={styles.stageText}>STAGE 2-6</Text>
                  <Text style={styles.worldText}>WORLD 2: THE KINETIC CRYSTALS</Text>
                </View>

                <View style={styles.bottomHUD}>
                  <View style={styles.hudCol}>
                    <Text style={styles.smallLabel}>COMBO</Text>
                    <Text style={[styles.comboVal, { color: combo > 0 ? '#0ff' : '#444' }]}>{combo}</Text>
                  </View>
                  <View style={styles.hudCol}>
                    <Text style={styles.smallLabel}>PERFECT</Text>
                    <Text style={styles.perfectVal}>{perfectPercent}%</Text>
                  </View>
                </View>
                <Text style={styles.tapHint}>TAP ANYWHERE</Text>
              </>
            )}

            {/* Menu */}
            {gameState === GameState.MENU && (
              <View style={styles.overlay}>
                <View style={styles.titleGlow}>
                  <Text style={styles.title}>ORBIT SYNC</Text>
                </View>
                <Text style={styles.subtitle}>WORLD 2: THE KINETIC CRYSTALS</Text>
                <Text style={styles.tapStart}>TAP TO START</Text>
              </View>
            )}

            {/* Game Over */}
            {gameState === GameState.GAME_OVER && !showReviveModal && (
              <View style={styles.darkOverlay}>
                <Text style={styles.gameOverTitle}>GAME OVER</Text>
                <Text style={styles.finalScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.finalCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.finalStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={styles.tapStart}>TAP TO RESTART</Text>
              </View>
            )}

            {/* Victory */}
            {gameState === GameState.VICTORY && !showDoubleCoinsModal && (
              <View style={styles.darkOverlay}>
                <Text style={styles.victoryTitle}>VICTORY!</Text>
                <Text style={styles.victoryBoss}>AETHELRED DEFEATED</Text>
                <Text style={styles.finalScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.finalCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.finalStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={styles.tapStart}>TAP TO PLAY AGAIN</Text>
              </View>
            )}
          </View>
        </GestureDetector>

        {/* Revive Modal */}
        <Modal visible={showReviveModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>CONTINUE?</Text>
              <Text style={styles.modalSub}>You ran out of lives!</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Score</Text>
                  <Text style={styles.statVal}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Coins</Text>
                  <Text style={[styles.statVal, { color: '#ffd700' }]}>{coins}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.reviveBtn} onPress={handleRevive}>
                <Ionicons name="heart" size={22} color="#fff" />
                <Text style={styles.reviveTxt}>REVIVE</Text>
                <Text style={styles.adTxt}>Watch Ad</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={() => setShowReviveModal(false)}>
                <Text style={styles.skipTxt}>No Thanks</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Double Coins Modal */}
        <Modal visible={showDoubleCoinsModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={[styles.modalBox, styles.victoryBox]}>
              <Text style={[styles.modalTitle, { color: '#0ff' }]}>VICTORY!</Text>
              <Text style={styles.modalSub}>Aethelred has been defeated!</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Final Score</Text>
                  <Text style={styles.statVal}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Coins Earned</Text>
                  <Text style={[styles.statVal, { color: '#ffd700' }]}>{coins}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.doubleBtn} onPress={handleDoubleCoins}>
                <Ionicons name="sparkles" size={22} color="#000" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030308' },
  gameArea: { flex: 1, backgroundColor: '#030308' },
  
  bgParticle: {
    position: 'absolute',
    backgroundColor: '#4af',
    borderRadius: 4,
  },
  
  bossContainer: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.1,
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 0.1,
  },
  bossCrystal: {
    width: 80,
    height: 110,
    borderWidth: 2,
    borderColor: '#f0f',
    transform: [{ rotate: '45deg' }],
  },
  
  // Track styling - SOLID COLORS FOR MAX VISIBILITY
  trackGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#006688',
    zIndex: 10,
  },
  trackMain: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#00FFFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 11,
  },
  
  // Corner nodes with glow
  cornerGlow: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 255, 255, 0.25)',
  },
  cornerNode: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cornerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#0ff',
  },
  
  // Target styling
  targetBase: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  standardOuter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 4,
    borderColor: '#0ff',
    backgroundColor: 'rgba(0, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  standardInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  
  cornerOuter: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 5,
    borderColor: '#0ff',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
  },
  cornerInnerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  
  dualOuter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 3,
    borderColor: '#fff',
  },
  dualLeft: { flex: 1, backgroundColor: 'rgba(0, 255, 255, 0.9)' },
  dualRight: { flex: 1, backgroundColor: 'rgba(255, 0, 255, 0.9)' },
  dualSeam: {
    position: 'absolute',
    width: 4,
    height: 54,
    backgroundColor: '#fff',
    left: 22,
    top: -2,
  },
  dualCenter: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
    left: 17,
    top: 17,
  },
  
  fractureOuter: {
    width: 48,
    height: 48,
    backgroundColor: '#fb4',
    transform: [{ rotate: '45deg' }],
    borderRadius: 6,
    borderWidth: 3,
    borderColor: '#ff0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fractureCrack1: {
    position: 'absolute',
    width: 3,
    height: 34,
    backgroundColor: '#ff0',
    transform: [{ rotate: '-45deg' }],
  },
  fractureCrack2: {
    position: 'absolute',
    width: 34,
    height: 3,
    backgroundColor: '#ff0',
    transform: [{ rotate: '-45deg' }],
  },
  
  shardOuter: {
    backgroundColor: '#fc8',
    borderWidth: 2,
    borderColor: '#fff',
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
  },
  
  // Player orb with layered glow
  playerGlowOuter: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 255, 255, 0.2)',
  },
  playerGlowInner: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 255, 255, 0.4)',
  },
  playerCore: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
  },
  
  // Hit effect ring
  hitRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    opacity: 0.8,
  },
  
  flash: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  
  // HUD styling
  topHUD: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hudCol: { alignItems: 'center' },
  labelGold: { fontSize: 11, fontWeight: 'bold', color: '#ffd700', marginBottom: 3 },
  valueGold: { fontSize: 20, fontWeight: 'bold', color: '#ffd700' },
  labelCyan: { fontSize: 11, fontWeight: 'bold', color: '#0ff', marginBottom: 3 },
  labelMagenta: { fontSize: 11, fontWeight: 'bold', color: '#f0f', marginBottom: 3 },
  valueWhite: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  livesRow: { flexDirection: 'row', gap: 5 },
  heart: { fontSize: 20 },
  
  waveBar: {
    position: 'absolute',
    top: 65,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  waveText: { fontSize: 14, color: '#666', fontWeight: '700' },
  bossName: { fontSize: 12, color: '#f0f', fontWeight: 'bold', marginBottom: 5 },
  hpBar: {
    width: '68%',
    height: 12,
    backgroundColor: '#222',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#fff',
  },
  hpFill: { height: '100%', backgroundColor: '#f0f', borderRadius: 6 },
  bossPhase: { fontSize: 10, color: '#888', marginTop: 5 },
  
  scoreBox: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -50,
    alignItems: 'center',
  },
  scoreLabel: { fontSize: 14, color: '#555', fontWeight: '700' },
  scoreValue: { fontSize: 44, color: '#fff', fontWeight: 'bold' },
  stageText: { fontSize: 12, color: '#444', marginTop: 4 },
  worldText: { fontSize: 10, color: '#333', marginTop: 3 },
  
  bottomHUD: {
    position: 'absolute',
    bottom: 60,
    left: 35,
    right: 35,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  smallLabel: { fontSize: 11, color: '#555', marginBottom: 3 },
  comboVal: { fontSize: 22, fontWeight: 'bold' },
  perfectVal: { fontSize: 22, fontWeight: 'bold', color: '#f0f' },
  tapHint: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 12,
    color: '#333',
  },
  
  // Overlays
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  darkOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  titleGlow: {
    padding: 10,
  },
  title: { fontSize: 42, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 15, color: '#0ff', marginTop: 12 },
  tapStart: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 65, opacity: 0.85 },
  gameOverTitle: { fontSize: 38, fontWeight: 'bold', color: '#f44' },
  victoryTitle: { fontSize: 42, fontWeight: 'bold', color: '#0ff' },
  victoryBoss: { fontSize: 16, color: '#f0f', marginTop: 12 },
  finalScore: { fontSize: 18, color: '#fff', marginTop: 25 },
  finalCoins: { fontSize: 16, color: '#ffd700', marginTop: 12 },
  finalStreak: { fontSize: 16, color: '#fff', marginTop: 12 },
  
  // Modals
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#0a0a0a',
    borderRadius: 24,
    padding: 32,
    width: '92%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#f44',
  },
  victoryBox: { borderColor: '#0ff' },
  modalTitle: { fontSize: 30, fontWeight: 'bold', color: '#f44', marginBottom: 10 },
  modalSub: { fontSize: 15, color: '#777', marginBottom: 26 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 28 },
  statCol: { alignItems: 'center' },
  statLabel: { fontSize: 11, color: '#555', marginBottom: 5, textTransform: 'uppercase' },
  statVal: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  reviveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f',
    paddingVertical: 16,
    paddingHorizontal: 34,
    borderRadius: 30,
    marginBottom: 16,
    gap: 12,
  },
  reviveTxt: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  adTxt: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginLeft: 6 },
  doubleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffd700',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 30,
    marginBottom: 16,
    gap: 10,
  },
  doubleTxt: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  adTxtDark: { fontSize: 11, color: 'rgba(0,0,0,0.65)' },
  skipBtn: { paddingVertical: 14, paddingHorizontal: 30 },
  skipTxt: { fontSize: 14, color: '#555' },
});
