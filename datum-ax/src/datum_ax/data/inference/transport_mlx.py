"""Native MLX transport for running models in-process using mlx-lm."""

from datum_ax.data.inference.transport import OmlxTransport
from datum_ax.data.inference.wire import ChatRequest, ChatResponse, Usage

class NativeMlxTransport(OmlxTransport):
    """Real transport to a local MLX model running in-process."""
    def __init__(self):
        self.loaded_models = {}

    async def complete(self, request: ChatRequest) -> ChatResponse:
        import mlx_lm
        # 1. Load or get cached model
        if request.model not in self.loaded_models:
            model, tokenizer = mlx_lm.load(request.model)
            self.loaded_models[request.model] = (model, tokenizer)
        else:
            model, tokenizer = self.loaded_models[request.model]

        # 2. Convert datum's ChatMessages into a standard prompt string
        messages_dict = [{"role": m.role, "content": m.content} for m in request.messages]
        prompt = tokenizer.apply_chat_template(messages_dict, tokenize=False, add_generation_prompt=True)

        # 3. Generate tokens natively on the Apple Silicon GPU
        text = mlx_lm.generate(
            model, 
            tokenizer, 
            prompt=prompt, 
            max_tokens=request.max_tokens, 
            temp=request.temperature
        )

        # 4. Return standard datum-ax ChatResponse
        return ChatResponse(
            text=text,
            usage=Usage(input_tokens=0, output_tokens=0),
            finish_reason="stop"
        )
