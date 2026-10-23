-- The two prompt helpers return a fixed string and read no tables, so an empty
-- search path cannot change what they do; pinning it clears the last
-- "function_search_path_mutable" findings from the Security Advisor.
-- 20261008163528_harden_function_search_paths.sql covered every other function.
alter function public.marketing_agent_system_instructions() set search_path = '';
alter function public.sales_agent_system_instructions() set search_path = '';
