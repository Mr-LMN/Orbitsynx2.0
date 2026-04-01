import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  View, 
  StyleSheet, 
  StatusBar, 
  SafeAreaView, 
  Text, 
  TouchableOpacity, 
  Modal, 
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================
// GAME CONSTANTS
// ============================================
const DIAMOND_SIZE_RATIO = 0.26;
const BASE_SPEED = 0.00035;
const WAVE_DURATION = 22000;

// Target Types
const TARGET_TYPES = {
  STANDARD: 'standard',
  CORNER_LOCK: 'corner_lock',
  DUAL: 'dual',
  FRACTURE: 'fracture',
  SHARD: 'shard'
};

// Game States
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
// DIAMOND TRACK LINE COMPONENT (using dots approach for web compatibility)
// ============================================
const TrackLine = ({ x1, y1, x2, y2, isGlow }: { x1: number; y1: number; x2: number; y2: number; isGlow?: boolean }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  // Create dots along the line for web compatibility
  const dotCount = Math.floor(length / (isGlow ? 8 : 5));
  const dots = [];
  
  for (let i = 0; i <= dotCount; i++) {
    const t = i / dotCount;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    
    dots.push(
      <View
        key={`dot-${i}`}
        style={{
          position: 'absolute',
          left: x - (isGlow ? 6 : 2),
          top: y - (isGlow ? 6 : 2),
          width: isGlow ? 12 : 4,
          height: isGlow ? 12 : 4,
          borderRadius: isGlow ? 6 : 2,
          backgroundColor: isGlow ? 'rgba(0, 255, 255, 0.2)' : '#00ffff',
        }}
      />
    );
  }
  
  return <>{dots}</>;
};

// ============================================
// MAIN GAME COMPONENT
// ============================================
export default function OrbitSyncGame() {
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
  const [tick, setTick] = useState(0);
  
  const lastTimeRef = useRef(Date.now());
  const waveTimerRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const targetIdRef = useRef(0);
  const playerProgressRef = useRef(0);
  
  const centerX = SCREEN_WIDTH / 2;
  const centerY = SCREEN_HEIGHT / 2 + 25;
  const diamondSize = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * DIAMOND_SIZE_RATIO;

  // Diamond vertices
  const vertices = [
    { x: centerX, y: centerY - diamondSize },
    { x: centerX + diamondSize, y: centerY },
    { x: centerX, y: centerY + diamondSize },
    { x: centerX - diamondSize, y: centerY }
  ];

  // Get spawn interval based on wave
  const getSpawnInterval = useCallback(() => {
    switch (currentWave) {
      case 1: return 2500;
      case 2: return 2100;
      case 3: return 1700;
      case 4: return 1400;
      default: return 2000;
    }
  }, [currentWave]);

  // Spawn a target
  const spawnTarget = useCallback((type: string, progress: number) => {
    const id = `target-${targetIdRef.current++}`;
    const target: Target = {
      id,
      type,
      progress,
      hitZone: type === TARGET_TYPES.CORNER_LOCK ? 0.026 : 
               type === TARGET_TYPES.FRACTURE ? 0.034 : 0.030,
      active: true,
      size: type === TARGET_TYPES.SHARD ? 0.6 + Math.random() * 0.4 : 1
    };
    setTargets(prev => [...prev, target]);
  }, []);

  // Spawn shards from fracture crystal
  const spawnShards = useCallback((progress: number) => {
    const shardCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < shardCount; i++) {
      const offset = 0.05 + i * 0.035;
      setTimeout(() => {
        spawnTarget(TARGET_TYPES.SHARD, (progress + offset) % 1);
      }, i * 80);
    }
  }, [spawnTarget]);

  // Spawn wave-specific target
  const spawnWaveTarget = useCallback((currentProgress: number, wave: number) => {
    const aheadProgress = (currentProgress + 0.30 + Math.random() * 0.10) % 1;
    
    switch (wave) {
      case 1:
        if (Math.random() < 0.25) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      
      case 2:
        const rand2 = Math.random();
        if (rand2 < 0.2) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
        } else if (rand2 < 0.45) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
      
      case 3:
        const rand3 = Math.random();
        if (rand3 < 0.15) {
          spawnTarget(TARGET_TYPES.FRACTURE, aheadProgress);
        } else if (rand3 < 0.35) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else if (rand3 < 0.5) {
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
        } else if (rand4 < 0.3) {
          const cornerProgress = Math.round(aheadProgress * 4) / 4;
          spawnTarget(TARGET_TYPES.CORNER_LOCK, cornerProgress % 1);
          setTimeout(() => {
            spawnTarget(TARGET_TYPES.DUAL, (cornerProgress + 0.08) % 1);
          }, 400);
        } else if (rand4 < 0.5) {
          spawnTarget(TARGET_TYPES.DUAL, aheadProgress);
        } else {
          spawnTarget(TARGET_TYPES.STANDARD, aheadProgress);
        }
        break;
    }
  }, [spawnTarget]);

  // Create flash effect
  const createFlash = useCallback((type: 'perfect' | 'miss') => {
    setFlashColor(type === 'perfect' ? 'rgba(0, 255, 255, 0.25)' : 'rgba(255, 0, 0, 0.4)');
    setTimeout(() => setFlashColor(null), 100);
  }, []);

  // Handle miss
  const handleMiss = useCallback(() => {
    setCombo(0);
    setStreak(0);
    setTotalHits(prev => prev + 1);
    setLives(prev => {
      const newLives = prev - 1;
      if (newLives <= 0) {
        setGameState(GameState.GAME_OVER);
        if (canRevive) {
          setTimeout(() => setShowReviveModal(true), 500);
        }
      }
      return newLives;
    });
    createFlash('miss');
  }, [canRevive, createFlash]);

  // Game loop
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    let animationId: number;
    
    const gameLoop = () => {
      const now = Date.now();
      const deltaTime = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Update player position
      const speedMultiplier = 1 + (currentWave - 1) * 0.10;
      playerProgressRef.current += BASE_SPEED * speedMultiplier * deltaTime;
      if (playerProgressRef.current >= 1) playerProgressRef.current -= 1;
      setPlayerProgress(playerProgressRef.current);

      // Wave progression
      waveTimerRef.current += deltaTime;
      if (waveTimerRef.current >= WAVE_DURATION && currentWave < 4) {
        setCurrentWave(prev => prev + 1);
        waveTimerRef.current = 0;
        createFlash('perfect');
      }

      // Spawn targets
      spawnTimerRef.current += deltaTime;
      if (spawnTimerRef.current >= getSpawnInterval()) {
        spawnTimerRef.current = 0;
        spawnWaveTarget(playerProgressRef.current, currentWave);
      }

      // Check for missed targets
      setTargets(prevTargets => {
        let shouldMiss = false;
        const newTargets = prevTargets.filter(target => {
          if (!target.active) return false;
          const dist = playerProgressRef.current - target.progress;
          if (dist > 0.07 && dist < 0.5) {
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

      // Force re-render
      setTick(t => t + 1);

      animationId = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = Date.now();
    animationId = requestAnimationFrame(gameLoop);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [gameState, currentWave, getSpawnInterval, spawnWaveTarget, handleMiss, createFlash]);

  // Handle tap
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

    // Find nearest target in hit range
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
      createFlash('perfect');
      setTargets(prev => prev.filter(t => t.id !== hitTarget!.id));
      
      const isPerfect = hitDistance < hitTarget.hitZone * 0.5;
      const baseScore = isPerfect ? 1000 : 750;
      const comboMultiplier = 1 + Math.floor(combo / 10) * 0.1;
      const waveMultiplier = currentWave;
      
      setScore(prev => prev + Math.floor(baseScore * comboMultiplier * waveMultiplier));
      setCoins(prev => prev + (isPerfect ? 15 : 10));
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
            setTimeout(() => setShowDoubleCoinsModal(true), 500);
            return 0;
          }
          return newHP;
        });
      }

      if (hitTarget.type === TARGET_TYPES.FRACTURE) {
        spawnShards(hitTarget.progress);
      }
    }
  }, [gameState, targets, combo, currentWave, createFlash, spawnShards]);

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

  // Render target based on type
  const renderTarget = (target: Target) => {
    const pos = getTrackPosition(target.progress, centerX, centerY, diamondSize);
    
    switch (target.type) {
      case TARGET_TYPES.STANDARD:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 22, top: pos.y - 22 }]}>
            <View style={styles.standardTarget}>
              <View style={styles.standardTargetInner} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.CORNER_LOCK:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 24, top: pos.y - 24, width: 48, height: 48 }]}>
            <View style={styles.cornerLockContainer}>
              <View style={styles.cornerLockArm1} />
              <View style={styles.cornerLockArm2} />
              <View style={styles.cornerLockCenter} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.DUAL:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 22, top: pos.y - 22 }]}>
            <View style={styles.dualTarget}>
              <View style={styles.dualTargetLeft} />
              <View style={styles.dualTargetRight} />
              <View style={styles.dualTargetSeam} />
              <View style={styles.dualTargetCenter} />
            </View>
          </View>
        );
      
      case TARGET_TYPES.FRACTURE:
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - 24, top: pos.y - 24, width: 48, height: 48 }]}>
            <View style={styles.fractureTarget} />
          </View>
        );
      
      case TARGET_TYPES.SHARD:
        const size = 18 * (target.size || 1);
        return (
          <View key={target.id} style={[styles.targetBase, { left: pos.x - size/2, top: pos.y - size/2, width: size, height: size }]}>
            <View style={[styles.shardTarget, { width: size - 2, height: size - 2 }]} />
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
            {/* Background particles */}
            {Array.from({ length: 30 }).map((_, i) => {
              const xPos = ((i * 43 + tick * 0.015) % SCREEN_WIDTH);
              const yPos = ((i * 67 + tick * 0.12) % SCREEN_HEIGHT);
              return (
                <View
                  key={`p-${i}`}
                  style={[
                    styles.particle,
                    {
                      left: xPos,
                      top: yPos,
                      width: (i % 3) + 2,
                      height: (i % 3) + 2,
                      opacity: 0.2 + (i % 4) * 0.1,
                    }
                  ]}
                />
              );
            })}

            {/* Boss background */}
            {currentWave === 4 && gameState === GameState.PLAYING && (
              <View style={styles.bossBackground}>
                <View style={styles.bossCrystal} />
              </View>
            )}

            {/* Diamond Track - Glow Lines */}
            {[0, 1, 2, 3].map(i => (
              <TrackLine
                key={`glow-${i}`}
                x1={vertices[i].x}
                y1={vertices[i].y}
                x2={vertices[(i + 1) % 4].x}
                y2={vertices[(i + 1) % 4].y}
                isGlow={true}
              />
            ))}

            {/* Diamond Track - Main Lines */}
            {[0, 1, 2, 3].map(i => (
              <TrackLine
                key={`line-${i}`}
                x1={vertices[i].x}
                y1={vertices[i].y}
                x2={vertices[(i + 1) % 4].x}
                y2={vertices[(i + 1) % 4].y}
                isGlow={false}
              />
            ))}

            {/* Corner nodes */}
            {vertices.map((v, i) => (
              <View key={`corner-${i}`} style={[styles.cornerNode, { left: v.x - 11, top: v.y - 11 }]}>
                <View style={styles.cornerNodeInner} />
              </View>
            ))}

            {/* Targets */}
            {gameState === GameState.PLAYING && targets.map(target => renderTarget(target))}

            {/* Player Orb */}
            {gameState === GameState.PLAYING && (
              <View style={[styles.playerOrb, { left: playerPos.x - 18, top: playerPos.y - 18 }]}>
                <View style={styles.playerOrbGlow} />
                <View style={styles.playerOrbCore} />
              </View>
            )}

            {/* Flash Effect */}
            {flashColor && (
              <View style={[styles.flashOverlay, { backgroundColor: flashColor }]} />
            )}

            {/* HUD */}
            {gameState === GameState.PLAYING && (
              <>
                <View style={styles.topHUD}>
                  <View style={styles.hudItem}>
                    <Text style={styles.hudLabelGold}>COINS</Text>
                    <Text style={styles.hudValueGold}>{coins.toLocaleString()}</Text>
                  </View>
                  <View style={styles.hudItem}>
                    <Text style={styles.hudLabelCyan}>LIVES</Text>
                    <View style={styles.livesContainer}>
                      {[0, 1, 2].map(i => (
                        <Text key={i} style={{ fontSize: 18, color: i < lives ? '#00ffff' : '#333' }}>
                          {'\u2665'}
                        </Text>
                      ))}
                    </View>
                  </View>
                  <View style={styles.hudItem}>
                    <Text style={styles.hudLabelMagenta}>STREAK</Text>
                    <Text style={styles.hudValueWhite}>x{streak}</Text>
                  </View>
                </View>

                <View style={styles.waveContainer}>
                  {currentWave === 4 ? (
                    <>
                      <Text style={styles.bossName}>AETHELRED, PRISM WARDEN</Text>
                      <View style={styles.bossHPBar}>
                        <View style={[styles.bossHPFill, { width: `${bossHP}%` }]} />
                      </View>
                      <Text style={styles.bossPhase}>BOSS PHASE</Text>
                    </>
                  ) : (
                    <Text style={styles.waveText}>WAVE {currentWave} / 4</Text>
                  )}
                </View>

                <View style={styles.centerScore}>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                  <Text style={styles.scoreValue}>{score.toLocaleString()}</Text>
                  <Text style={styles.stageLabel}>STAGE 2-6</Text>
                  <Text style={styles.worldLabel}>WORLD 2: THE KINETIC CRYSTALS</Text>
                </View>

                <View style={styles.bottomHUD}>
                  <View style={styles.hudItem}>
                    <Text style={styles.hudLabelSmall}>COMBO</Text>
                    <Text style={[styles.comboValue, { color: combo > 0 ? '#00ffff' : '#444' }]}>{combo}</Text>
                  </View>
                  <View style={styles.hudItem}>
                    <Text style={styles.hudLabelSmall}>PERFECT</Text>
                    <Text style={styles.perfectValue}>{perfectPercent}%</Text>
                  </View>
                </View>
                <Text style={styles.tapHint}>TAP ANYWHERE</Text>
              </>
            )}

            {/* Menu Screen */}
            {gameState === GameState.MENU && (
              <View style={styles.menuOverlay}>
                <Text style={styles.menuTitle}>ORBIT SYNC</Text>
                <Text style={styles.menuSubtitle}>WORLD 2: THE KINETIC CRYSTALS</Text>
                <Text style={styles.menuTapStart}>TAP TO START</Text>
              </View>
            )}

            {/* Game Over Screen */}
            {gameState === GameState.GAME_OVER && !showReviveModal && (
              <View style={styles.gameOverOverlay}>
                <Text style={styles.gameOverTitle}>GAME OVER</Text>
                <Text style={styles.gameOverScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.gameOverCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.gameOverStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={styles.menuTapStart}>TAP TO RESTART</Text>
              </View>
            )}

            {/* Victory Screen */}
            {gameState === GameState.VICTORY && !showDoubleCoinsModal && (
              <View style={styles.victoryOverlay}>
                <Text style={styles.victoryTitle}>VICTORY!</Text>
                <Text style={styles.victoryBoss}>AETHELRED DEFEATED</Text>
                <Text style={styles.gameOverScore}>Final Score: {score.toLocaleString()}</Text>
                <Text style={styles.gameOverCoins}>Coins: {coins.toLocaleString()}</Text>
                <Text style={styles.gameOverStreak}>Max Streak: x{maxStreak}</Text>
                <Text style={styles.menuTapStart}>TAP TO PLAY AGAIN</Text>
              </View>
            )}
          </View>
        </GestureDetector>

        {/* Revive Modal */}
        <Modal visible={showReviveModal} transparent animationType="fade" onRequestClose={() => setShowReviveModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>CONTINUE?</Text>
              <Text style={styles.modalSubtitle}>You ran out of lives!</Text>
              
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Score</Text>
                  <Text style={styles.statValue}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Coins</Text>
                  <Text style={[styles.statValue, { color: '#ffd700' }]}>{coins}</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.reviveButton} onPress={handleRevive}>
                <Ionicons name="heart" size={24} color="#fff" />
                <Text style={styles.reviveButtonText}>REVIVE</Text>
                <Text style={styles.revivePrice}>Watch Ad</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipButton} onPress={() => setShowReviveModal(false)}>
                <Text style={styles.skipButtonText}>No Thanks</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Double Coins Modal */}
        <Modal visible={showDoubleCoinsModal} transparent animationType="fade" onRequestClose={() => setShowDoubleCoinsModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, styles.victoryModal]}>
              <Text style={[styles.modalTitle, { color: '#00ffff' }]}>VICTORY!</Text>
              <Text style={styles.modalSubtitle}>Aethelred has been defeated!</Text>
              
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Final Score</Text>
                  <Text style={styles.statValue}>{score.toLocaleString()}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Coins Earned</Text>
                  <Text style={[styles.statValue, { color: '#ffd700' }]}>{coins}</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.doubleCoinsButton} onPress={handleDoubleCoins}>
                <Ionicons name="sparkles" size={24} color="#000" />
                <Text style={styles.doubleCoinsButtonText}>DOUBLE COINS!</Text>
                <Text style={styles.doubleCoinsSub}>Watch Ad</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipButton} onPress={() => setShowDoubleCoinsModal(false)}>
                <Text style={styles.skipButtonText}>Collect {coins} coins</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  gameArea: {
    flex: 1,
    backgroundColor: '#050510',
  },
  particle: {
    position: 'absolute',
    backgroundColor: 'rgba(100, 180, 255, 0.6)',
    borderRadius: 3,
  },
  bossBackground: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.15,
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 0.12,
  },
  bossCrystal: {
    width: 100,
    height: 140,
    borderWidth: 2,
    borderColor: '#ff00ff',
    transform: [{ rotate: '45deg' }],
  },
  cornerNode: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cornerNodeInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00ffff',
  },
  targetBase: {
    position: 'absolute',
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  standardTarget: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: '#00ffff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 255, 0.12)',
  },
  standardTargetInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  cornerLockContainer: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cornerLockArm1: {
    position: 'absolute',
    width: 24,
    height: 4,
    backgroundColor: '#00ffff',
    borderRadius: 2,
    left: 4,
    top: 18,
    transform: [{ rotate: '-30deg' }],
  },
  cornerLockArm2: {
    position: 'absolute',
    width: 24,
    height: 4,
    backgroundColor: '#00ffff',
    borderRadius: 2,
    right: 4,
    top: 18,
    transform: [{ rotate: '30deg' }],
  },
  cornerLockCenter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  dualTarget: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  dualTargetLeft: {
    flex: 1,
    backgroundColor: 'rgba(0, 255, 255, 0.85)',
  },
  dualTargetRight: {
    flex: 1,
    backgroundColor: 'rgba(255, 0, 255, 0.85)',
  },
  dualTargetSeam: {
    position: 'absolute',
    width: 3,
    height: 46,
    backgroundColor: '#ffffff',
    left: 18.5,
    top: -2,
  },
  dualTargetCenter: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    left: 15,
    top: 15,
  },
  fractureTarget: {
    width: 36,
    height: 36,
    backgroundColor: 'rgba(255, 180, 80, 0.95)',
    transform: [{ rotate: '45deg' }],
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ffff00',
  },
  shardTarget: {
    backgroundColor: 'rgba(255, 200, 100, 0.95)',
    borderWidth: 1,
    borderColor: '#ffffff',
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },
  playerOrb: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerOrbGlow: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 255, 255, 0.45)',
  },
  playerOrbCore: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topHUD: {
    position: 'absolute',
    top: 12,
    left: 15,
    right: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  hudItem: {
    alignItems: 'center',
  },
  hudLabelGold: { fontSize: 11, fontWeight: 'bold', color: '#ffd700', marginBottom: 3 },
  hudValueGold: { fontSize: 18, fontWeight: 'bold', color: '#ffd700' },
  hudLabelCyan: { fontSize: 11, fontWeight: 'bold', color: '#00ffff', marginBottom: 3 },
  hudLabelMagenta: { fontSize: 11, fontWeight: 'bold', color: '#ff00ff', marginBottom: 3 },
  hudValueWhite: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  livesContainer: { flexDirection: 'row', gap: 5 },
  waveContainer: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
  waveText: { fontSize: 13, color: '#666', fontWeight: '600' },
  bossName: { fontSize: 11, color: '#ff00ff', fontWeight: 'bold', marginBottom: 5 },
  bossHPBar: { width: '65%', height: 10, backgroundColor: '#222', borderRadius: 5, overflow: 'hidden', borderWidth: 1, borderColor: '#fff' },
  bossHPFill: { height: '100%', backgroundColor: '#ff00ff', borderRadius: 5 },
  bossPhase: { fontSize: 10, color: '#888', marginTop: 4 },
  centerScore: { position: 'absolute', top: '50%', left: 0, right: 0, marginTop: -40, alignItems: 'center' },
  scoreLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  scoreValue: { fontSize: 38, color: '#ffffff', fontWeight: 'bold' },
  stageLabel: { fontSize: 11, color: '#555', marginTop: 3 },
  worldLabel: { fontSize: 9, color: '#444', marginTop: 2 },
  bottomHUD: { position: 'absolute', bottom: 55, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between' },
  hudLabelSmall: { fontSize: 10, color: '#666', marginBottom: 2 },
  comboValue: { fontSize: 20, fontWeight: 'bold' },
  perfectValue: { fontSize: 20, fontWeight: 'bold', color: '#ff00ff' },
  tapHint: { position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#333' },
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  menuTitle: { fontSize: 36, fontWeight: 'bold', color: '#ffffff' },
  menuSubtitle: { fontSize: 14, color: '#00ffff', marginTop: 10 },
  menuTapStart: { fontSize: 18, fontWeight: 'bold', color: '#ffffff', marginTop: 60, opacity: 0.8 },
  gameOverOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.88)' },
  gameOverTitle: { fontSize: 32, fontWeight: 'bold', color: '#ff4444' },
  gameOverScore: { fontSize: 17, color: '#ffffff', marginTop: 20 },
  gameOverCoins: { fontSize: 15, color: '#ffd700', marginTop: 10 },
  gameOverStreak: { fontSize: 15, color: '#ffffff', marginTop: 10 },
  victoryOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.88)' },
  victoryTitle: { fontSize: 36, fontWeight: 'bold', color: '#00ffff' },
  victoryBoss: { fontSize: 15, color: '#ff00ff', marginTop: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.88)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#111', borderRadius: 20, padding: 28, width: '90%', maxWidth: 330, alignItems: 'center', borderWidth: 2, borderColor: '#ff4444' },
  victoryModal: { borderColor: '#00ffff' },
  modalTitle: { fontSize: 28, fontWeight: 'bold', color: '#ff4444', marginBottom: 8 },
  modalSubtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 24 },
  statItem: { alignItems: 'center' },
  statLabel: { fontSize: 10, color: '#666', marginBottom: 5, textTransform: 'uppercase' },
  statValue: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  reviveButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff00ff', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 28, marginBottom: 14, gap: 10 },
  reviveButtonText: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  revivePrice: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginLeft: 5 },
  doubleCoinsButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffd700', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 28, marginBottom: 14, gap: 8 },
  doubleCoinsButtonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  doubleCoinsSub: { fontSize: 10, color: 'rgba(0,0,0,0.6)' },
  skipButton: { paddingVertical: 12, paddingHorizontal: 28 },
  skipButtonText: { fontSize: 13, color: '#666' },
});
