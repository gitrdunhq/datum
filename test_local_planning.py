import json
from datum.local_llm import run_phase
from datum_ax.core.planner.lane_plan import LanePlan

def main():
    prompt_text = "make a checkers game using html and pure css . it should be 2 player"
    
    print("Running local plan phase...")
    result = run_phase(
        phase="plan",
        prompt=prompt_text,
        schema=LanePlan,
        mt_overrides={"max_turns": 5}
    )
    
    if result.get("escalated"):
        print("\n=== ESCALATED ===")
        print("Raw result object:")
        print(result)
        print("Turns:")
        for i, turn in enumerate(result.get("turns", [])):
            print(f"\n--- Turn {i + 1} ---")
            print(json.dumps(turn, indent=2))
    else:
        print("\n=== SUCCESS ===")
        print(result.get("result"))

if __name__ == "__main__":
    main()
