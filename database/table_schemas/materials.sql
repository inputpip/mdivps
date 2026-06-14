--
-- PostgreSQL database dump
--

\restrict dFbDXKczSQwk2eWwSvvf0miHohhYAmog6RQV7Vy2Lwp5PiPX7jKKFpRCZB9cVuR

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
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    barcode text,
    unit text NOT NULL,
    price_per_unit numeric NOT NULL,
    stock numeric NOT NULL,
    min_stock numeric NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'Stock'::text,
    branch_id uuid,
    cost_price numeric(15,2) DEFAULT 0,
    CONSTRAINT materials_type_check CHECK ((type = ANY (ARRAY['Stock'::text, 'Beli'::text])))
);


--
-- Name: COLUMN materials.stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.materials.stock IS 'DEPRECATED: Use v_material_current_stock.current_stock instead. This column is kept for backwards compatibility only.';


--
-- Name: COLUMN materials.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.materials.type IS 'Jenis bahan: Stock (produksi menurunkan stock), Beli (produksi menambah stock)';


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: idx_materials_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_name ON public.materials USING btree (name);


--
-- Name: idx_materials_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_stock ON public.materials USING btree (stock);


--
-- Name: materials materials_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dFbDXKczSQwk2eWwSvvf0miHohhYAmog6RQV7Vy2Lwp5PiPX7jKKFpRCZB9cVuR

