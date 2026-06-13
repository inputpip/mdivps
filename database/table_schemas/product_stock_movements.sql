--
-- PostgreSQL database dump
--

\restrict 1AfQYONeNe7QHpYgoDE3QT31hW8yiKBTTh5YrdgD2jheQGK3ogpX1QaAHafYaQx

-- Dumped from database version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.20 (Ubuntu 14.20-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: product_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    branch_id uuid,
    type character varying(10) NOT NULL,
    reason character varying(50) NOT NULL,
    quantity numeric(15,2) NOT NULL,
    previous_stock numeric(15,2) DEFAULT 0,
    new_stock numeric(15,2) DEFAULT 0,
    reference_id text,
    reference_type text,
    notes text,
    user_id uuid,
    user_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_stock_movements_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT product_stock_movements_type_check CHECK (((type)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying])::text[])))
);


--
-- Name: product_stock_movements product_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: idx_product_stock_movements_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_branch ON public.product_stock_movements USING btree (branch_id);


--
-- Name: idx_product_stock_movements_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_created ON public.product_stock_movements USING btree (created_at);


--
-- Name: idx_product_stock_movements_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_product ON public.product_stock_movements USING btree (product_id);


--
-- Name: idx_product_stock_movements_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_type ON public.product_stock_movements USING btree (type);


--
-- Name: product_stock_movements product_stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: product_stock_movements product_stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: product_stock_movements product_stock_movements_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_stock_movements_allow_all ON public.product_stock_movements TO authenticated USING (true) WITH CHECK (true);

--
-- PostgreSQL database dump complete
--

\unrestrict 1AfQYONeNe7QHpYgoDE3QT31hW8yiKBTTh5YrdgD2jheQGK3ogpX1QaAHafYaQx

