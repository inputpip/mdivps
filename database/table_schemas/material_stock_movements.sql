--
-- PostgreSQL database dump
--

\restrict vjNbBgbaPvMPu0yk6aGb2eS1taacgtoN0zAVLMAlhN6l811Ie8Dx4Pab3QtBkaH

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
-- Name: material_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    material_name text NOT NULL,
    type text NOT NULL,
    reason text NOT NULL,
    quantity numeric NOT NULL,
    previous_stock numeric NOT NULL,
    new_stock numeric NOT NULL,
    notes text,
    reference_id text,
    reference_type text,
    user_id uuid,
    user_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    CONSTRAINT material_stock_movements_reason_check CHECK ((reason = ANY (ARRAY['PURCHASE'::text, 'PRODUCTION_CONSUMPTION'::text, 'PRODUCTION_ACQUISITION'::text, 'ADJUSTMENT'::text, 'RETURN'::text, 'PRODUCTION_ERROR'::text, 'PRODUCTION_DELETE_RESTORE'::text]))),
    CONSTRAINT material_stock_movements_type_check CHECK ((type = ANY (ARRAY['IN'::text, 'OUT'::text, 'ADJUSTMENT'::text]))),
    CONSTRAINT positive_quantity CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE material_stock_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.material_stock_movements IS 'History of all material stock movements and changes';


--
-- Name: COLUMN material_stock_movements.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.type IS 'Type of movement: IN (stock bertambah), OUT (stock berkurang), ADJUSTMENT (penyesuaian)';


--
-- Name: COLUMN material_stock_movements.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reason IS 'Reason for movement: PURCHASE, PRODUCTION_CONSUMPTION, PRODUCTION_ACQUISITION, ADJUSTMENT, RETURN, PRODUCTION_ERROR, PRODUCTION_DELETE_RESTORE';


--
-- Name: COLUMN material_stock_movements.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.quantity IS 'Quantity moved (always positive)';


--
-- Name: COLUMN material_stock_movements.previous_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.previous_stock IS 'Stock before this movement';


--
-- Name: COLUMN material_stock_movements.new_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.new_stock IS 'Stock after this movement';


--
-- Name: COLUMN material_stock_movements.reference_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reference_id IS 'ID of related record (transaction, purchase order, etc)';


--
-- Name: COLUMN material_stock_movements.reference_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reference_type IS 'Type of reference (transaction, purchase_order, etc)';


--
-- Name: material_stock_movements material_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT material_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: idx_material_stock_movements_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_created_at ON public.material_stock_movements USING btree (created_at DESC);


--
-- Name: idx_material_stock_movements_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_material ON public.material_stock_movements USING btree (material_id);


--
-- Name: idx_material_stock_movements_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_reference ON public.material_stock_movements USING btree (reference_id, reference_type);


--
-- Name: idx_material_stock_movements_type_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_type_reason ON public.material_stock_movements USING btree (type, reason);


--
-- Name: idx_material_stock_movements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_user ON public.material_stock_movements USING btree (user_id);


--
-- Name: material_stock_movements fk_material_stock_movement_material; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT fk_material_stock_movement_material FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_stock_movements fk_material_stock_movement_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT fk_material_stock_movement_user FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: material_stock_movements material_stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT material_stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: material_stock_movements material_stock_movements_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY material_stock_movements_allow_all ON public.material_stock_movements TO authenticated USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict vjNbBgbaPvMPu0yk6aGb2eS1taacgtoN0zAVLMAlhN6l811Ie8Dx4Pab3QtBkaH

