import os
import yaml
import numpy as np
from pathlib import Path

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("WARNING: sentence-transformers not found. Please install: uv pip install sentence-transformers pyyaml numpy")

class PersonaRAG:
    """
    Lightweight RAG system that uses local embeddings to dynamically select
    the correct architectural Persona based on the incoming ticket/prompt.
    """
    def __init__(self, personas_dir="~/repos/personas/distilled", model_name="all-MiniLM-L6-v2"):
        self.personas_dir = Path(os.path.expanduser(personas_dir))
        self.personas = []
        self.persona_embeddings = None
        
        try:
            # all-MiniLM-L6-v2 is ultra-fast, local, and perfect for short descriptions
            self.model = SentenceTransformer(model_name)
        except NameError:
            self.model = None
            
        self._load_and_embed_personas()
        
    def _load_and_embed_personas(self):
        if not self.personas_dir.exists() or not self.model:
            return
            
        texts_to_embed = []
        for file_path in self.personas_dir.glob("*.md"):
            content = file_path.read_text(encoding="utf-8")
            
            # Parse YAML frontmatter to extract the description
            description = ""
            name = file_path.stem
            
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    try:
                        frontmatter = yaml.safe_load(parts[1])
                        description = frontmatter.get("description", "")
                        name = frontmatter.get("name", name)
                    except yaml.YAMLError:
                        pass
                        
            # We embed ONLY the name and description. This prevents the vector search 
            # from getting confused by the actual rules in the body.
            embed_text = f"Skill Name: {name}\nPurpose: {description}"
            texts_to_embed.append(embed_text)
            
            self.personas.append({
                "path": file_path,
                "name": name,
                "content": content
            })
            
        # Pre-compute embeddings for all persona descriptions in memory
        if texts_to_embed:
            self.persona_embeddings = self.model.encode(texts_to_embed, convert_to_numpy=True)
            
    def cosine_similarity(self, a, b):
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
        
    def retrieve(self, ticket_text, threshold=0.3):
        """
        Embeds the incoming ticket and returns the markdown content of the highest-matching persona.
        Returns None if no persona meets the semantic similarity threshold.
        """
        if not self.personas or self.persona_embeddings is None:
            return None
            
        ticket_embedding = self.model.encode([ticket_text], convert_to_numpy=True)[0]
        
        best_score = -1
        best_persona = None
        
        for idx, persona in enumerate(self.personas):
            score = self.cosine_similarity(ticket_embedding, self.persona_embeddings[idx])
            if score > best_score:
                best_score = score
                best_persona = persona
                
        if best_score >= threshold:
            print(f"[RAG] 🎯 Retrieved Skill: {best_persona['name']} (Confidence Score: {best_score:.2f})")
            return best_persona['content']
            
        print(f"[RAG] ⚠️ No specific persona met the threshold (Highest: {best_score:.2f})")
        return None

def build_orchestrator_prompt(ticket_text, base_persona_path="~/repos/BASE_PERSONA.md"):
    """
    Assembles the final system prompt: BASE_PERSONA + [DYNAMIC_RAG_PERSONA] + TICKET
    """
    base_path = Path(os.path.expanduser(base_persona_path))
    prompt = base_path.read_text(encoding="utf-8") if base_path.exists() else "Base rules missing."
    
    rag = PersonaRAG()
    skill_persona = rag.retrieve(ticket_text)
    
    if skill_persona:
        prompt += "\n\n" + "#" * 50 + "\n# DYNAMIC SKILL INJECTION\n" + "#" * 50 + "\n\n"
        prompt += skill_persona
        
    prompt += "\n\n" + "#" * 50 + "\n# CURRENT ASSIGNMENT\n" + "#" * 50 + "\n\n"
    prompt += ticket_text
    
    return prompt

if __name__ == "__main__":
    import sys
    
    # Test Ticket if none provided
    ticket = sys.argv[1] if len(sys.argv) > 1 else (
        "I need to build a new Astro component for the marketing site and wire "
        "it up to a Cloudflare D1 database table. Make sure the local build works."
    )
    
    print("\n[RAG] Incoming Ticket:", ticket)
    print("[RAG] Querying vector space...\n")
    
    final_prompt = build_orchestrator_prompt(ticket)
    
    print("\n--- FINAL ASSEMBLED PROMPT PREVIEW ---")
    print(final_prompt[:800] + "\n\n... [TRUNCATED FOR DISPLAY] ... \n\n" + final_prompt[-800:])
