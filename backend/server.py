from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ============================================
# MODELS
# ============================================

class PlayerStats(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_name: str = "Player"
    total_coins: int = 0
    high_score: int = 0
    total_games_played: int = 0
    total_perfect_hits: int = 0
    max_streak: int = 0
    bosses_defeated: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class GameSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_id: str
    score: int
    coins_earned: int
    max_streak: int
    perfect_percentage: float
    waves_completed: int
    boss_defeated: bool = False
    revive_used: bool = False
    double_coins_used: bool = False
    played_at: datetime = Field(default_factory=datetime.utcnow)

class GameSessionCreate(BaseModel):
    player_id: str
    score: int
    coins_earned: int
    max_streak: int
    perfect_percentage: float
    waves_completed: int
    boss_defeated: bool = False
    revive_used: bool = False
    double_coins_used: bool = False

class LeaderboardEntry(BaseModel):
    player_name: str
    high_score: int
    max_streak: int
    bosses_defeated: int

class PurchaseRequest(BaseModel):
    player_id: str
    purchase_type: str  # 'revive' or 'double_coins'
    coins_before: int
    coins_after: int

class PurchaseRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_id: str
    purchase_type: str
    coins_before: int
    coins_after: int
    purchased_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================
# ROUTES
# ============================================

@api_router.get("/")
async def root():
    return {"message": "Orbit Sync API - World 2: The Kinetic Crystals"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "game": "Orbit Sync"}


# Player Stats Routes
@api_router.post("/players", response_model=PlayerStats)
async def create_player(player_name: str = "Player"):
    """Create a new player profile"""
    player = PlayerStats(player_name=player_name)
    await db.players.insert_one(player.dict())
    return player

@api_router.get("/players/{player_id}", response_model=PlayerStats)
async def get_player(player_id: str):
    """Get player stats by ID"""
    player = await db.players.find_one({"id": player_id})
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return PlayerStats(**player)

@api_router.put("/players/{player_id}/stats")
async def update_player_stats(
    player_id: str,
    coins_earned: int = 0,
    score: int = 0,
    max_streak: int = 0,
    perfect_hits: int = 0,
    boss_defeated: bool = False
):
    """Update player stats after a game session"""
    player = await db.players.find_one({"id": player_id})
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    
    update_data = {
        "total_coins": player.get("total_coins", 0) + coins_earned,
        "total_games_played": player.get("total_games_played", 0) + 1,
        "total_perfect_hits": player.get("total_perfect_hits", 0) + perfect_hits,
        "updated_at": datetime.utcnow()
    }
    
    if score > player.get("high_score", 0):
        update_data["high_score"] = score
    
    if max_streak > player.get("max_streak", 0):
        update_data["max_streak"] = max_streak
    
    if boss_defeated:
        update_data["bosses_defeated"] = player.get("bosses_defeated", 0) + 1
    
    await db.players.update_one({"id": player_id}, {"$set": update_data})
    
    updated_player = await db.players.find_one({"id": player_id})
    return PlayerStats(**updated_player)


# Game Session Routes
@api_router.post("/sessions", response_model=GameSession)
async def create_game_session(session_data: GameSessionCreate):
    """Record a completed game session"""
    session = GameSession(**session_data.dict())
    await db.sessions.insert_one(session.dict())
    return session

@api_router.get("/sessions/{player_id}", response_model=List[GameSession])
async def get_player_sessions(player_id: str, limit: int = 10):
    """Get recent game sessions for a player"""
    sessions = await db.sessions.find(
        {"player_id": player_id}
    ).sort("played_at", -1).limit(limit).to_list(limit)
    return [GameSession(**s) for s in sessions]


# Leaderboard Routes
@api_router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(limit: int = 10):
    """Get top players by high score"""
    players = await db.players.find().sort("high_score", -1).limit(limit).to_list(limit)
    return [
        LeaderboardEntry(
            player_name=p.get("player_name", "Player"),
            high_score=p.get("high_score", 0),
            max_streak=p.get("max_streak", 0),
            bosses_defeated=p.get("bosses_defeated", 0)
        )
        for p in players
    ]


# Purchase/Monetization Routes
@api_router.post("/purchases")
async def record_purchase(purchase: PurchaseRequest):
    """Record a monetization action (revive or double coins)"""
    record = PurchaseRecord(**purchase.dict())
    await db.purchases.insert_one(record.dict())
    return {"success": True, "purchase_id": record.id}

@api_router.get("/purchases/{player_id}")
async def get_player_purchases(player_id: str):
    """Get purchase history for a player"""
    purchases = await db.purchases.find({"player_id": player_id}).to_list(100)
    return [{"id": p["id"], "type": p["purchase_type"], "purchased_at": p["purchased_at"]} for p in purchases]


# Statistics Routes
@api_router.get("/stats/global")
async def get_global_stats():
    """Get global game statistics"""
    total_players = await db.players.count_documents({})
    total_sessions = await db.sessions.count_documents({})
    total_bosses_defeated = await db.sessions.count_documents({"boss_defeated": True})
    
    # Get highest score ever
    top_player = await db.players.find_one(sort=[("high_score", -1)])
    highest_score = top_player.get("high_score", 0) if top_player else 0
    
    return {
        "total_players": total_players,
        "total_games_played": total_sessions,
        "total_bosses_defeated": total_bosses_defeated,
        "highest_score_ever": highest_score
    }


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
