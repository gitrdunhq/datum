from datum_ax.contracts.context import CodeContext, DocContext, NlCompressor, SymbolSlice
from datum_ax.contracts.inference import TokenBudget, AssembledPrompt
import json
from typing import List, Dict, Optional, Set, Any

class ContextBudgetExceededError(Exception):
    """
    Thrown when the essential, un-prunable payload exceeds the hard limit.
    Forces the planner to decompose the task. (ADR-0022)
    """
    pass

class ContextCrane:
    """
    The Intelligent Context Crane.
    Orchestrates the Context Firewall (ADR-0004), Dynamic Context Pruning (ADR-0021),
    and Budget-Aware Lane Granularity (ADR-0022).
    """
    
    def __init__(
        self,
        code_context: CodeContext,
        doc_context: DocContext,
        nl_compressor: NlCompressor,
        budget: TokenBudget,
        token_counter: Any # e.g. a tiktoken encoder
    ):
        self.code_context = code_context
        self.doc_context = doc_context
        self.compressor = nl_compressor
        self.budget = budget
        self.token_counter = token_counter
        
        # SymbolRegistry for Deduplication
        self._hoisted_symbols: Set[str] = set()

    def estimate_lane_footprint(self, system: str, global_ast: str, diff: str) -> int:
        """
        Pre-calculates the token footprint before execution (ADR-0022).
        If the prefix alone exceeds the max_input limit, forces decomposition.
        """
        prefix = f"{system}\n{global_ast}\n{diff}"
        estimated_tokens = len(self.token_counter.encode(prefix))
        
        if estimated_tokens > self.budget.max_input:
            raise ContextBudgetExceededError(
                f"Lane essential footprint ({estimated_tokens} tokens) exceeds hard limit ({self.budget.max_input}). "
                "Planner must decompose."
            )
            
        return estimated_tokens

    def hoist_docs(self, library_names: List[str]) -> str:
        """
        Resolves library IDs, fetches docs via Context7, and compresses via Headroom.ai.
        """
        docs = []
        for lib in library_names:
            doc = self.doc_context.library_docs(lib)
            compressed_doc = self.compressor.compress(doc, self.budget)
            docs.append(compressed_doc.text)
        return "\n".join(docs)

    def hoist_code(self, symbols: List[str]) -> str:
        """
        Uses CodeContext to fetch EXACT AST slices (Lossless).
        Applies deduplication using the SymbolRegistry.
        """
        slices = []
        for sym in symbols:
            if sym not in self._hoisted_symbols:
                slice_data = self.code_context.symbol(sym)
                slices.append(slice_data.content)
                self._hoisted_symbols.add(sym)
        return "\n".join(slices)

    def pack_payload(self, ticket: str, dag_state: Dict[str, Any], history: List[Dict[str, str]], libs: List[str], symbols: List[str]) -> AssembledPrompt:
        """
        Builds the final AssembledPrompt guaranteeing prompt-cache safety (ADR-0021).
        """
        
        # 1. Gather prefix parts
        system_rules = "BASE_PERSONA & SKILL_PERSONA_HERE"
        context7_docs = self.hoist_docs(libs)
        
        system = f"{system_rules}\n\n{context7_docs}"
        global_ast = self.hoist_code(symbols)
        diff = "" # Unused on initialization, updated during execution
        
        # 2. Check Plan-Time Budget (ADR-0022)
        self.estimate_lane_footprint(system, global_ast, diff)
        
        # 3. Assemble Suffix
        dag_state_str = json.dumps(dag_state, separators=(',', ':'))
        history_str = "\n".join([f"[{h['role'].upper()}]: {h['content']}" for h in history])
        suffix = f"--- EXECUTION STATE ---\n{dag_state_str}\n\n--- RECENT HISTORY ---\n{history_str}\n\n--- CURRENT TICKET ---\n{ticket}"
        
        # 4. Return compliant AssembledPrompt Contract
        return AssembledPrompt(
            system=system,
            global_ast=global_ast,
            diff=diff,
            suffix=(suffix,)
        )
